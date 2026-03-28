# Database Backup to AWS S3

## Document Information

| Field            | Value                   |
|------------------|-------------------------|
| **Created**      | 2026-05-18              |
| **Last Updated** | 2026-05-19              |
| **Author**       | wiloon                  |
| **AI Assisted**  | Yes (Claude Sonnet 4.6) |
| **Status**       | Approved                |
| **Version**      | 1.3.0                   |

> This backup stack is **more complex than necessary** for a small weekly SQLite dump. The extra pieces (Scheduler, Lambda, SSM, DLQ, CloudWatch, SNS, optional Telegram) exist mainly to **practice and learn AWS services**, not because enx-api production load requires them.

## Overview

The `enx-api` SQLite database (`enx.db`) is automatically backed up to AWS S3 **weekly** (Sunday at 03:00 UTC).

**Production path:** EventBridge Scheduler → Lambda `enx-api-backup` → **SSM Run Command** (`SendCommand` on EC2; see blog note `aws-systems-manager`) → `/usr/local/bin/enx-api-backup.sh` on EC2 Tokyo.

Scheduling and manual triggers use **AWS only** (Scheduler / `aws lambda invoke`). There is no systemd timer or service on EC2.

## Architecture

```
EventBridge Scheduler  (enx-api-backup-weekly, Sunday 03:00 UTC)
  └─ invoke Lambda: enx-api-backup
       │  retry: up to 3 attempts within 1 hour (exponential backoff)
       │  on persistent failure → SQS DLQ: enx-api-backup-scheduler-dlq
       └─ SSM SendCommand → EC2 Tokyo
            └─ Lambda polls GetCommandInvocation until Success / Failed / timeout (120s)
                 └─ /usr/local/bin/enx-api-backup.sh
                      ├─ sqlite3 .backup  →  /tmp/enx-api-<timestamp>.db
                      ├─ aws s3 cp        →  s3://wiloon-enx-backup/
                      └─ rm /tmp/enx-api-<timestamp>.db

DLQ message visible (≥1) triggers:
  CloudWatch Alarm: enx-api-backup-scheduler-dlq
    └─ SNS Topic: enx-api-backup-alerts
         ├─ email  →  backup_alert_email (default wiloon.wy@gmail.com)
         └─ lambda →  sns-telegram-notify  (optional, if terraform.tfvars set)
```

> **DLQ does not notify humans by itself.** It stores failed Scheduler delivery payloads. **CloudWatch Alarm → SNS** sends email / Telegram when the DLQ has at least one message.

### What counts as a failure?

| Scenario | Retries + DLQ + SNS alert? |
|----------|----------------------------|
| Scheduler cannot invoke Lambda (permissions, throttling, etc.) | Yes |
| Lambda times out or errors (SSM failed, script non-zero, poll timeout) | Yes |
| Lambda returns success but S3 object missing | Unlikely if SSM reports Success; verify S3 separately |

## Backup Details

| Item | Value |
|------|-------|
| **Database path** | `/var/lib/enx-api/enx.db` |
| **S3 bucket** | `wiloon-enx-backup` (ap-northeast-1) |
| **Object key format** | `enx-api-<YYYYMMDD-HHMMSS>.db` |
| **Schedule** | `cron(0 3 ? * SUN *)` — weekly Sunday 03:00 UTC |
| **Scheduler name** | `enx-api-backup-weekly` |
| **Retention** | 30 days (S3 lifecycle rule) |
| **Backup method** | `sqlite3 .backup` (online, safe while DB is in use) |
| **EC2 auth** | IAM Instance Profile (`ec2-tokyo-profile`) |
| **Retry policy** | Max 3 retries, max 1 hour (`maximum_event_age_in_seconds = 3600`) |
| **DLQ** | `enx-api-backup-scheduler-dlq` (SQS, 14-day retention) |
| **CloudWatch Alarm** | `enx-api-backup-scheduler-dlq` |
| **SNS Topic** | `enx-api-backup-alerts` |
| **Telegram** | Optional via `sns-telegram-notify` Lambda + `@wiloon_pipi_bot` |

## Backup Script

Deployed to `/usr/local/bin/enx-api-backup.sh` on EC2 (Ansible):

```bash
#!/bin/bash
set -e
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="/tmp/enx-api-${TIMESTAMP}.db"
S3_BUCKET="wiloon-enx-backup"
DB_PATH="/var/lib/enx-api/enx.db"

sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"
aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/enx-api-${TIMESTAMP}.db"
rm -f "${BACKUP_FILE}"

echo "Backup completed: enx-api-${TIMESTAMP}.db"
```

## Infrastructure Configuration

All AWS resources are managed by OpenTofu in `w10n-config` (`aws/opentofu/ec2-tokyo/`).

### EC2 Instance Profile (`ec2-tokyo-profile`)

- S3 on `wiloon-enx-backup`: `PutObject`, `GetObject`, `ListBucket`, `DeleteObject`
- `AmazonSSMManagedInstanceCore` (SSM Agent receives Run Command)

### Lambda `enx-api-backup` (`lambda-enx-backup-role`)

- `ssm:SendCommand`, `ssm:GetCommandInvocation` on the EC2 instance
- CloudWatch Logs: `/aws/lambda/enx-api-backup`
- Timeout: **120s**; raises error on SSM failure → Scheduler retries → DLQ

### EventBridge Scheduler (`scheduler-enx-backup-role`)

- `lambda:InvokeFunction` on `enx-api-backup`
- `sqs:SendMessage` on DLQ (after retries exhausted)

### Alerting stack

| Resource | Purpose |
|----------|---------|
| `aws_sqs_queue.enx_backup_scheduler_dlq` | Dead-letter queue for failed invocations |
| `aws_cloudwatch_metric_alarm.enx_backup_scheduler_dlq` | Fires when DLQ depth ≥ 1 |
| `aws_sns_topic.enx_backup_alerts` | Fan-out to email + optional Telegram |
| `aws_lambda_function.sns_telegram_notify` | SNS subscription → Telegram Bot API (if `telegram_*` vars set) |

Secrets (`telegram_bot_token`) live in **`terraform.tfvars`** (gitignored), not in the repo.

### IAM for `tofu apply`

User `tofu-deploy` needs SQS / SNS / CloudWatch Alarm permissions in addition to EC2 / Lambda / IAM. Policy template: `w10n-config/aws/docs/iam-tofu-deploy-backup-alerts.json`.

No AWS access keys on the instance — all access uses IAM roles.

## Implementation History

Initial rollout in `w10n-config` (chronological):

### 1. OpenTofu: S3 backup bucket (`aws/opentofu/ec2-tokyo/main.tf`)

- `aws_s3_bucket.enx_backup` — `wiloon-enx-backup`, ap-northeast-1
- `aws_s3_bucket_public_access_block` — fully private
- `aws_s3_bucket_lifecycle_configuration` — expire objects after 30 days

### 2. OpenTofu: EC2 IAM (`main.tf`)

| Resource | Name | Notes |
|----------|------|-------|
| `aws_iam_role` | `ec2-tokyo-role` | Trust `ec2.amazonaws.com` |
| `aws_iam_role_policy` | `ec2-tokyo-s3-backup` | Scoped to `wiloon-enx-backup` only |
| `aws_iam_instance_profile` | `ec2-tokyo-profile` | Attached to EC2 |

Allowed S3 actions: `PutObject`, `GetObject`, `ListBucket`, `DeleteObject`.

### 3. Ansible: backup script on EC2 (`install-enx-api-backup.yml`, tag `enx-api-backup`)

- Packages: `aws-cli`, `sqlite`; SSM Agent running
- Script: `/usr/local/bin/enx-api-backup.sh` (invoked by Lambda via SSM)
- Legacy `enx-api-backup.service` / `.timer` removed by playbook

### 4. OpenTofu: Scheduler, Lambda, DLQ, SNS, Telegram (`lambda.tf`)

- Weekly `enx-api-backup-weekly` schedule
- Lambda polls SSM until backup script completes
- Retry policy, DLQ, CloudWatch Alarm, SNS email, optional Telegram via `sns-telegram-notify`

## Operations

### Deploy / update infrastructure

```bash
cd w10n-config/aws/opentofu/ec2-tokyo
# terraform.tfvars: ssh_public_key, optional telegram_bot_token + telegram_chat_id
tofu plan
tofu apply
```

Deploy or refresh backup script on EC2:

```bash
cd w10n-config/aws/ansible/ec2-tokyo
ansible-playbook site.yml --tags enx-api-backup
```

### Trigger a manual backup (same path as Scheduler)

Use Lambda invoke so SSM runs the script and failures follow the same retry/alert path as the weekly schedule:

```bash
aws lambda invoke --region ap-northeast-1 \
  --function-name enx-api-backup \
  /tmp/enx-api-backup-out.json && cat /tmp/enx-api-backup-out.json

aws s3 ls s3://wiloon-enx-backup/
```

### Check Lambda logs

```bash
aws logs tail /aws/lambda/enx-api-backup --region ap-northeast-1 --since 1h
aws logs tail /aws/lambda/sns-telegram-notify --region ap-northeast-1 --since 1h   # if enabled
```

### First-time SNS email subscription

After `tofu apply`, confirm the **AWS SNS subscription** email; alarms will not send mail until confirmed.

### Telegram alerts (optional)

In `terraform.tfvars` (see `terraform.tfvars.example`):

1. Message `@wiloon_pipi_bot`, then `curl` `getUpdates` for `chat.id`
2. Set `telegram_bot_token` and `telegram_chat_id`
3. `tofu apply` — creates `sns-telegram-notify` Lambda + SNS subscription

### Test SNS (email + Telegram)

```bash
TOPIC_ARN=$(aws sns list-topics --region ap-northeast-1 \
  --query 'TopicArns[?contains(@, `enx-api-backup-alerts`)] | [0]' --output text)

aws sns publish --region ap-northeast-1 \
  --topic-arn "$TOPIC_ARN" \
  --subject "enx-api backup test" \
  --message "test notification"
```

### Inspect DLQ after a failure

```bash
aws sqs receive-message --region ap-northeast-1 \
  --queue-url "$(cd w10n-config/aws/opentofu/ec2-tokyo && tofu output -raw enx_backup_scheduler_dlq_url)" \
  --max-number-of-messages 1
```

### List backups in S3

```bash
aws s3 ls s3://wiloon-enx-backup/
```

### Restore from backup

```bash
aws s3 cp s3://wiloon-enx-backup/enx-api-<timestamp>.db /tmp/enx-api-restore.db

sudo systemctl stop enx-api
sudo cp /var/lib/enx-api/enx.db /var/lib/enx-api/enx.db.pre-restore
sudo cp /tmp/enx-api-restore.db /var/lib/enx-api/enx.db
sudo systemctl start enx-api
```

## Configuration Files (w10n-config)

| File | Purpose |
|------|---------|
| `aws/opentofu/ec2-tokyo/main.tf` | S3 bucket, EC2 IAM, lifecycle |
| `aws/opentofu/ec2-tokyo/lambda.tf` | Scheduler, Lambda, DLQ, SNS, CloudWatch Alarm, Telegram |
| `aws/opentofu/ec2-tokyo/variables.tf` | `backup_alert_email`, `telegram_*` |
| `aws/opentofu/ec2-tokyo/terraform.tfvars.example` | Example secrets / Telegram vars |
| `aws/opentofu/ec2-tokyo/outputs.tf` | `enx_backup_scheduler_dlq_url`, etc. |
| `aws/lambda/enx-api-backup/lambda_function.py` | SSM trigger + poll until complete |
| `aws/lambda/sns-telegram-notify/lambda_function.py` | SNS → Telegram |
| `aws/ansible/ec2-tokyo/install-enx-api-backup.yml` | Backup script on EC2 (no systemd) |
| `aws/docs/iam-tofu-deploy-backup-alerts.json` | IAM policy for `tofu-deploy` |

## Troubleshooting

### EC2 replaced when adding IAM Instance Profile

**Symptom:** First `tofu apply` with `iam_instance_profile` on EC2 triggered **ForceNew** — instance recreated (Elastic IP unchanged).

**Fix:** Re-run full Ansible on EC2 (`site.yml`) to restore nginx, enx-api, backup script, etc.

### `tofu-deploy` missing IAM permissions

**Symptom:** `iam:CreateRole` denied when creating `ec2-tokyo-role`.

**Fix:** Grant `tofu-deploy` IAM create/attach permissions (inline policy or `iam:*` for homelab).

### `sqlite3: command not found` during SSM backup

**Symptom:** Lambda/SSM reports failure; SSM output shows `sqlite3: command not found`.

**Cause:** Amazon Linux 2023 does not ship `sqlite3` by default.

**Fix:** Re-run Ansible (`install-enx-api-backup.yml` installs the `sqlite` package), then trigger backup via `aws lambda invoke`.

### `tofu-deploy` missing SQS / SNS / CloudWatch permissions

**Symptom:**

```text
AccessDenied: sqs:CreateQueue
AuthorizationError: SNS:CreateTopic
```

**Fix:** Attach policy from `w10n-config/aws/docs/iam-tofu-deploy-backup-alerts.json` to user `tofu-deploy`, then `tofu apply` again.

## Related blog notes (optional)

| Topic | Path (blog repo) |
|-------|------------------|
| EventBridge Scheduler | `content/post/cloud/aws/eventbridge-scheduler.md` |
| Systems Manager (Run Command) | `content/post/cloud/aws/systems-manager.md` |
| SQS / DLQ | `content/post/cloud/aws/sqs.md` |
| CloudWatch / Alarms | `content/post/cloud/aws/cloudwatch.md` |
| SNS | `content/post/cloud/aws/sns.md` |
