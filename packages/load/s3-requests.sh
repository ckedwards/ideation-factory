#!/bin/bash
# The deployment's buckets' S3 requests, by kind, and the bytes read from them (DEPLOYMENT.md), from
# S3's request metrics: what the engines ask of a bucket at rest and under load, and what a
# deployment outside the bucket's cloud pays to read back. Run from your machine, signed in to AWS;
# the buckets are the ones in .data/aws-keys.env.
#
#   s3-requests.sh on                 turn request metrics on for both buckets (a few cents a day);
#                                     they start about 15 minutes later
#   s3-requests.sh read FROM TO       totals and rates an hour between two times, UTC (2026-11-14T20:00)
#   s3-requests.sh off                turn them off again
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$HERE/.data/aws-keys.env"
export AWS_REGION=${S3_REGION:-eu-central-1}
BUCKETS=("$S3_ENGINE_BUCKET" "$S3_FILES_BUCKET")
METRICS=(GetRequests PutRequests ListRequests HeadRequests DeleteRequests AllRequests BytesDownloaded BytesUploaded)

total() {
  aws cloudwatch get-metric-statistics --namespace AWS/S3 --metric-name "$2" \
    --dimensions Name=BucketName,Value="$1" Name=FilterId,Value=all \
    --start-time "$3" --end-time "$4" --period 3600 --statistics Sum \
    --query 'sum(Datapoints[].Sum)' --output text
}

case "${1:-}" in
  on | off)
    for bucket in "${BUCKETS[@]}"; do
      if [ "$1" = on ]; then
        aws s3api put-bucket-metrics-configuration --bucket "$bucket" --id all --metrics-configuration Id=all
      else
        aws s3api delete-bucket-metrics-configuration --bucket "$bucket" --id all
      fi
      echo "$bucket: request metrics $1"
    done
    ;;
  read)
    from=${2:?from, UTC, like 2026-11-14T20:00}
    to=${3:?to, UTC}
    hours=$(( ($(date -ud "$to" +%s) - $(date -ud "$from" +%s)) / 3600 ))
    [ "$hours" -ge 1 ] || { echo "the window must be at least an hour: S3's metrics come by the minute, summed here by the hour" >&2; exit 2; }
    for bucket in "${BUCKETS[@]}"; do
      echo "$bucket, $from to $to ($hours h):"
      for metric in "${METRICS[@]}"; do
        sum=$(total "$bucket" "$metric" "$from" "$to")
        [ "$sum" = None ] && sum=0
        awk -v m="$metric" -v s="$sum" -v h="$hours" 'BEGIN {
          if (m ~ /^Bytes/) printf "  %-16s %10.2f GB   %8.3f GB an hour\n", m, s / 1e9, s / 1e9 / h
          else printf "  %-16s %12d     %10d an hour\n", m, s, s / h }'
      done
    done
    ;;
  *)
    sed -n '2,11p' "$0"
    exit 2
    ;;
esac
