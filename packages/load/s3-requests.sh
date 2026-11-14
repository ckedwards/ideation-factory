#!/bin/bash
# The deployment's buckets' S3 requests, by kind, and the bytes read from them (DEPLOYMENT.md), from
# S3's request metrics: what the engines ask of a bucket at rest and under load, and what a
# deployment outside the bucket's cloud pays to read back. Run from your machine, signed in to AWS;
# the buckets are the ones in .data/aws-keys.env. The engine bucket's are also split by prefix: the
# cluster's coordination (rivet/cluster/), each node's storage records (rivet/depot/cluster/), and
# the data (rivet/depot/tablets/).
#
#   s3-requests.sh on                 turn request metrics on (a few cents a day); they start about
#                                     15 minutes later
#   s3-requests.sh read FROM TO       totals, and rates an hour, between two UTC times (2026-11-14T20:00)
#   s3-requests.sh off                turn them off again
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$HERE/.data/aws-keys.env"
export AWS_REGION=${S3_REGION:-eu-central-1}
METRICS=(GetRequests PutRequests ListRequests HeadRequests DeleteRequests BytesDownloaded BytesUploaded)
# bucket, filter ID, prefix ("" for the whole bucket)
FILTERS=(
  "$S3_ENGINE_BUCKET all "
  "$S3_ENGINE_BUCKET cluster rivet/cluster/"
  "$S3_ENGINE_BUCKET depot-cluster rivet/depot/cluster/"
  "$S3_ENGINE_BUCKET tablets rivet/depot/tablets/"
  "$S3_FILES_BUCKET all "
)

total() {
  aws cloudwatch get-metric-statistics --namespace AWS/S3 --metric-name "$3" \
    --dimensions Name=BucketName,Value="$1" Name=FilterId,Value="$2" \
    --start-time "$4" --end-time "$5" --period 60 --statistics Sum \
    --query 'sum(Datapoints[].Sum)' --output text
}

case "${1:-}" in
  on | off)
    for f in "${FILTERS[@]}"; do
      read -r bucket id prefix <<<"$f"
      if [ "$1" = on ]; then
        config="Id=$id"
        [ -n "${prefix:-}" ] && config="{\"Id\":\"$id\",\"Filter\":{\"Prefix\":\"$prefix\"}}"
        aws s3api put-bucket-metrics-configuration --bucket "$bucket" --id "$id" --metrics-configuration "$config"
      else
        aws s3api delete-bucket-metrics-configuration --bucket "$bucket" --id "$id" 2>/dev/null || true
      fi
      echo "$bucket ${prefix:-(all)}: request metrics $1"
    done
    ;;
  read)
    from=${2:?from, UTC, like 2026-11-14T20:00}
    to=${3:?to, UTC}
    minutes=$(( ($(date -ud "$to" +%s) - $(date -ud "$from" +%s)) / 60 ))
    [ "$minutes" -ge 5 ] || { echo "the window must be at least 5 minutes" >&2; exit 2; }
    for f in "${FILTERS[@]}"; do
      read -r bucket id prefix <<<"$f"
      echo "$bucket ${prefix:-(all)}, $from to $to ($minutes min):"
      for metric in "${METRICS[@]}"; do
        sum=$(total "$bucket" "$id" "$metric" "$from" "$to")
        [ "$sum" = None ] && sum=0
        awk -v m="$metric" -v s="$sum" -v n="$minutes" 'BEGIN {
          if (m ~ /^Bytes/) printf "  %-16s %10.1f MB   %9.1f MB an hour\n", m, s / 1e6, s / 1e6 * 60 / n
          else printf "  %-16s %12d     %10d an hour\n", m, s, s * 60 / n }'
      done
    done
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
