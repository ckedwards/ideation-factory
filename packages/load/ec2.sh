#!/bin/bash
# The deployment benchmark's machines on EC2 (DEPLOYMENT.md), in eu-central-1 unless AWS_REGION says
# otherwise. Everything it makes is tagged Project=ideaf-bench, and found again by that tag, so each
# command is safe to run again. It uses the AWS CLI's own sign-in (aws login).
#
#   MY_IP=1.2.3.4 ./ec2.sh up   the network, security groups and the five instances (billing starts);
#                             with DIRECTORY_MACHINES=1, the dedicated directory tier's two as well
#   ec2.sh ls                 the instances and their addresses
#   ec2.sh stop | start       stop (the disks keep the data, about $1 a day) or start them again
#   ec2.sh down               terminate the instances and their disks (the network stays: it's free)
set -euo pipefail
export AWS_REGION=${AWS_REGION:-eu-central-1}
ZONE=${ZONE:-${AWS_REGION}a}
TAG=ideaf-bench

# name, type, private address, disk in GB, security group
MACHINES=(
  "ideaf-lb    c7i.large   10.0.0.10 30  lb"
  "ideaf-node1 m7i.xlarge  10.0.0.11 100 node"
  "ideaf-node2 m7i.xlarge  10.0.0.12 100 node"
  "ideaf-node3 m7i.xlarge  10.0.0.13 100 node"
  "ideaf-load  c7i.xlarge  10.0.0.20 30  load"
)
# the dedicated directory tier: a directory process on each, connected to a node's engine
if [ "${DIRECTORY_MACHINES:-0}" = 1 ]; then
  MACHINES+=(
    "ideaf-dir1  m7i.xlarge  10.0.0.21 30  directory"
    "ideaf-dir2  m7i.xlarge  10.0.0.22 30  directory"
  )
fi

tags() { echo "ResourceType=$1,Tags=[{Key=Name,Value=$2},{Key=Project,Value=$TAG}]"; }
none() { [ -z "$1" ] || [ "$1" = None ]; }
instances() {
  aws ec2 describe-instances --filters "Name=tag:Project,Values=$TAG" \
    "Name=instance-state-name,Values=pending,running,stopping,stopped" "$@"
}

up() {
  : "${MY_IP:?set MY_IP, the address SSH is allowed from}"

  # 1. the network: a VPC, one public subnet in one zone, its route out, and S3 inside AWS
  vpc=$(aws ec2 describe-vpcs --filters "Name=tag:Project,Values=$TAG" --query 'Vpcs[0].VpcId' --output text)
  if none "$vpc"; then
    vpc=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications "$(tags vpc ideaf)" \
      --query Vpc.VpcId --output text)
    aws ec2 modify-vpc-attribute --vpc-id "$vpc" --enable-dns-hostnames
  fi
  subnet=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpc" --query 'Subnets[0].SubnetId' --output text)
  if none "$subnet"; then
    subnet=$(aws ec2 create-subnet --vpc-id "$vpc" --cidr-block 10.0.0.0/24 --availability-zone "$ZONE" \
      --tag-specifications "$(tags subnet ideaf)" --query Subnet.SubnetId --output text)
    aws ec2 modify-subnet-attribute --subnet-id "$subnet" --map-public-ip-on-launch
  fi
  igw=$(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$vpc" \
    --query 'InternetGateways[0].InternetGatewayId' --output text)
  if none "$igw"; then
    igw=$(aws ec2 create-internet-gateway --tag-specifications "$(tags internet-gateway ideaf)" \
      --query InternetGateway.InternetGatewayId --output text)
    aws ec2 attach-internet-gateway --internet-gateway-id "$igw" --vpc-id "$vpc"
  fi
  rtb=$(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$vpc" "Name=association.main,Values=true" \
    --query 'RouteTables[0].RouteTableId' --output text)
  aws ec2 create-route --route-table-id "$rtb" --destination-cidr-block 0.0.0.0/0 --gateway-id "$igw" \
    >/dev/null 2>&1 || true
  if none "$(aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=$vpc" \
    "Name=service-name,Values=com.amazonaws.$AWS_REGION.s3" --query 'VpcEndpoints[0].VpcEndpointId' --output text)"; then
    aws ec2 create-vpc-endpoint --vpc-id "$vpc" --service-name "com.amazonaws.$AWS_REGION.s3" \
      --route-table-ids "$rtb" --tag-specifications "$(tags vpc-endpoint ideaf-s3)" >/dev/null
  fi
  echo "network: $vpc, subnet $subnet in $ZONE"

  # 2. your SSH key
  aws ec2 describe-key-pairs --key-names ideaf-laptop >/dev/null 2>&1 \
    || aws ec2 import-key-pair --key-name ideaf-laptop --public-key-material "fileb://$HOME/.ssh/id_ed25519.pub" \
      --tag-specifications "$(tags key-pair ideaf-laptop)" >/dev/null

  # 3. the security groups: SSH from you on each, and between the machines only what DEPLOYMENT.md lists
  declare -A sg
  for role in node lb load directory; do
    sg[$role]=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpc" "Name=group-name,Values=ideaf-$role" \
      --query 'SecurityGroups[0].GroupId' --output text)
    if none "${sg[$role]}"; then
      sg[$role]=$(aws ec2 create-security-group --vpc-id "$vpc" --group-name "ideaf-$role" \
        --description "ideaf-bench $role" --tag-specifications "$(tags security-group "ideaf-$role")" \
        --query GroupId --output text)
    fi
  done
  allow() {
    aws ec2 authorize-security-group-ingress --group-id "$1" --ip-permissions "$2" >/dev/null 2>&1 || true
  }
  for role in node lb load directory; do
    allow "${sg[$role]}" "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$MY_IP/32,Description=you}]"
    allow "${sg[$role]}" "IpProtocol=icmp,FromPort=-1,ToPort=-1,IpRanges=[{CidrIp=10.0.0.0/16,Description=ping}]"
  done
  allow "${sg[node]}" "IpProtocol=tcp,FromPort=8080,ToPort=8080,UserIdGroupPairs=[{GroupId=${sg[lb]}},{GroupId=${sg[load]}}]"
  allow "${sg[node]}" "IpProtocol=tcp,FromPort=6421,ToPort=6421,UserIdGroupPairs=[{GroupId=${sg[node]}}]"
  allow "${sg[node]}" "IpProtocol=tcp,FromPort=22,ToPort=22,UserIdGroupPairs=[{GroupId=${sg[load]}}]"
  allow "${sg[lb]}" "IpProtocol=tcp,FromPort=443,ToPort=443,UserIdGroupPairs=[{GroupId=${sg[load]}}]"
  allow "${sg[load]}" "IpProtocol=tcp,FromPort=1025,ToPort=1025,UserIdGroupPairs=[{GroupId=${sg[node]}}]"
  # the directory machines: the nodes' engines' API, sign-in emails to Mailpit, docker stats from the load machine
  allow "${sg[node]}" "IpProtocol=tcp,FromPort=6420,ToPort=6420,UserIdGroupPairs=[{GroupId=${sg[directory]}}]"
  allow "${sg[load]}" "IpProtocol=tcp,FromPort=1025,ToPort=1025,UserIdGroupPairs=[{GroupId=${sg[directory]}}]"
  allow "${sg[directory]}" "IpProtocol=tcp,FromPort=22,ToPort=22,UserIdGroupPairs=[{GroupId=${sg[load]}}]"
  echo "security groups: node ${sg[node]}, lb ${sg[lb]}, load ${sg[load]}, directory ${sg[directory]}"

  # 4. the instances, Ubuntu 24.04 with Docker (billing starts here)
  ami=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text)
  for m in "${MACHINES[@]}"; do
    read -r name type ip disk role <<<"$m"
    if ! none "$(instances --filters "Name=tag:Name,Values=$name" --query 'Reservations[0].Instances[0].InstanceId' --output text)"; then
      continue
    fi
    data=$(mktemp)
    cat >"$data" <<EOF
#!/bin/bash
set -eux
hostnamectl set-hostname $name
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
apt-get install -y git jq unzip tmux
if [ $role = load ]; then
  su - ubuntu -c 'curl -fsSL https://bun.sh/install | bash'
fi
EOF
    aws ec2 run-instances --image-id "$ami" --instance-type "$type" --subnet-id "$subnet" \
      --private-ip-address "$ip" --security-group-ids "${sg[$role]}" --key-name ideaf-laptop \
      --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":$disk,\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
      --metadata-options HttpTokens=required --user-data "file://$data" \
      --tag-specifications "$(tags instance "$name")" "$(tags volume "$name")" \
      --query 'Instances[0].InstanceId' --output text
    rm -f "$data"
  done
  aws ec2 wait instance-running --instance-ids $(ids)
  ls
}

ids() { instances --query 'Reservations[].Instances[].InstanceId' --output text; }

ls() {
  instances --query 'Reservations[].Instances[].[Tags[?Key==`Name`]|[0].Value,InstanceType,State.Name,PublicIpAddress,PrivateIpAddress]' \
    --output table
}

case "${1:-}" in
  up) up ;;
  ls) ls ;;
  stop) aws ec2 stop-instances --instance-ids $(ids) --query 'StoppingInstances[].InstanceId' --output text ;;
  start)
    aws ec2 start-instances --instance-ids $(ids) --query 'StartingInstances[].InstanceId' --output text
    aws ec2 wait instance-running --instance-ids $(ids)
    ls
    ;;
  down)
    aws ec2 terminate-instances --instance-ids $(ids) --query 'TerminatingInstances[].InstanceId' --output text
    ;;
  *)
    sed -n '2,9p' "$0"
    exit 2
    ;;
esac
