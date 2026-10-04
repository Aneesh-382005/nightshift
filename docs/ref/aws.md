# AWS cheat sheet: demo VM + Bedrock
Researched 2026-10-03 from docs.aws.amazon.com. All CLI is REFERENCE ONLY (nothing was run).
Tags: VERIFIED = seen in the cited AWS page. UNVERIFIED = from general knowledge, check before relying on it.
Shell vars used below (set your own):
    export AWS_REGION=us-east-1
    export AWS_DEFAULT_REGION=$AWS_REGION

## 0. Free tier and credits first
- VERIFIED: Accounts created on or after 2025-07-15 get a $100 sign-up credit plus up to $100 more credits,
  free tier lasts 6 months or until credits run out. Eligible types: t3.micro, t3.small, t4g.micro, t4g.small,
  c7i-flex.large, m7i-flex.large. Older accounts: t2.micro/t3.micro, 12 months.
  Source: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html
- VERIFIED: list eligible types for your account:
      aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true \
        --query "InstanceTypes[*].[InstanceType]" --output text | sort

## 1. Launch a VM (console, fastest)
UNVERIFIED (console layout drifts), standard flow:
1. Console, region top right (pick one and stay in it), EC2, Launch instance.
2. Name: `mhacks-demo`. AMI: Amazon Linux 2023 or Ubuntu 24.04 (both "Free tier eligible" tagged).
3. Instance type: t3.micro (x86_64) or t4g.micro (arm64 Graviton; AMI arch must match).
4. Key pair: Create new, ed25519, .pem. The download happens once.
5. Network settings, Edit: Allow SSH traffic from "My IP" (not Anywhere). Public IP: enable.
6. Storage: default 8 GiB gp3 is fine. Launch.
7. Wait for 2/2 status checks, copy Public IPv4 address.
Default SSH users: Amazon Linux 2023 = `ec2-user` (VERIFIED, used in the SSM ssh config doc below);
Ubuntu = `ubuntu` (UNVERIFIED, widely documented).

## 2. Key pair (CLI)
VERIFIED (https://docs.aws.amazon.com/cli/latest/userguide/cli-services-ec2-keypairs.html):
    aws ec2 create-key-pair --key-name mhacks-demo --query 'KeyMaterial' --output text > mhacks-demo.pem
    chmod 400 mhacks-demo.pem
    aws ec2 describe-key-pairs --key-name mhacks-demo
    aws ec2 delete-key-pair --key-name mhacks-demo     # cleanup
Private key is retrievable only at creation. Key pairs are regional.
UNVERIFIED: add `--key-type ed25519` for an ed25519 key (RSA is the default).

## 3. Security group, SSH only from your IP
VERIFIED (https://docs.aws.amazon.com/cli/latest/userguide/cli-services-ec2-sg.html):
    MYIP=$(curl -s https://checkip.amazonaws.com)
    aws ec2 create-security-group --group-name mhacks-demo-sg --description "mhacks demo ssh" --vpc-id vpc-XXXX
    aws ec2 authorize-security-group-ingress --group-id sg-XXXX --protocol tcp --port 22 --cidr ${MYIP}/32
    aws ec2 describe-security-groups --group-ids sg-XXXX
    aws ec2 delete-security-group --group-id sg-XXXX    # cleanup; fails while an instance still uses it
Notes: the doc's own example writes `--cidr x.x.x.x/x`; use `/32` for a single IP (UNVERIFIED but standard CIDR).
Hackathon wifi NAT or a phone hotspot changes your IP. If SSH stops working, re-run authorize with the new IP.
UNVERIFIED: find default VPC with
`aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text`.
UNVERIFIED: omit `--vpc-id` to use the default VPC.

## 4. Launch via CLI
VERIFIED pattern (AL2023 SSM parameter, https://docs.aws.amazon.com/linux/al2023/ug/ec2.html):
    # x86_64, t3.micro, Amazon Linux 2023
    aws ec2 run-instances \
      --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
      --instance-type t3.micro --key-name mhacks-demo --security-group-ids sg-XXXX \
      --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=mhacks-demo}]'
    # arm64, t4g.micro: swap to ...al2023-ami-kernel-default-arm64 and --instance-type t4g.micro
- VERIFIED: other parameter names: `al2023-ami-minimal-kernel-default-{x86_64,arm64}`, pinned `al2023-ami-kernel-6.1-...`.
- VERIFIED: from 2026-08-17 the default AL2023 kernel moves from 6.1 to 6.18 for new launches. Pin `kernel-6.1` if you
  want the old one.
- VERIFIED (https://ubuntu.com/aws/docs/aws-how-to/instances/find-ubuntu-images/) Ubuntu 24.04 AMI lookup:
      aws ssm get-parameters --names /aws/service/canonical/ubuntu/server/noble/stable/current/amd64/hvm/ebs-gp3/ami-id
      # arm64: same path with arm64
  Use as `--image-id resolve:ssm:/aws/service/canonical/ubuntu/server/noble/stable/current/amd64/hvm/ebs-gp3/ami-id`
  (the `resolve:ssm:` form is VERIFIED for the Amazon path; applying it to the Canonical path is UNVERIFIED but standard).
- VERIFIED: `--tag-specifications` is not shown in the fetched page; the separate `create-tags` form is:
      aws ec2 create-tags --resources i-XXXX --tags Key=Name,Value=mhacks-demo
- Get IP / wait for running (UNVERIFIED, standard):
      aws ec2 wait instance-running --instance-ids i-XXXX
      aws ec2 describe-instances --instance-ids i-XXXX --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
- VERIFIED: list instances: `aws ec2 describe-instances --filters "Name=tag:Name,Values=mhacks-demo"`.

## 5. SSH from CLI and from Node (ssh2)
CLI (UNVERIFIED, standard):
    ssh -i mhacks-demo.pem ec2-user@<public-ip>      # ubuntu@... for Ubuntu
    ssh -o StrictHostKeyChecking=accept-new -i mhacks-demo.pem ec2-user@<ip> 'uptime'
Node, ssh2 (https://github.com/mscdex/ssh2). VERIFIED: `new Client()`, `conn.on('ready')`, `conn.exec(cmd, ...)`,
`privateKey: readFileSync(path)` (OpenSSH format, optional `passphrase`). The stream handling below is UNVERIFIED
(standard ssh2 API, test it):
    const { readFileSync } = require('fs');
    const { Client } = require('ssh2');
    const conn = new Client();
    conn.on('ready', () => {
      conn.exec('uptime', (err, stream) => {
        if (err) throw err;
        stream.on('close', (code) => { console.log('exit', code); conn.end(); })
              .on('data', (d) => process.stdout.write(d))
              .stderr.on('data', (d) => process.stderr.write(d));
      });
    }).connect({
      host: process.env.VM_HOST, port: 22, username: 'ec2-user',
      privateKey: readFileSync(process.env.VM_KEY),
      readyTimeout: 20000,
    });
Gotchas: ssh2 wants an OpenSSH or PEM key; an AWS RSA .pem works. Each `exec` is a fresh shell (no persistent cwd/env);
use `conn.shell()` or chain with `cd x && ...` for stateful work. `sudo` works without a password for ec2-user/ubuntu
(UNVERIFIED, standard).

## 6. SSM Session Manager (no open port 22)
VERIFIED (https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-prerequisites.html and
.../session-manager-getting-started-enable-ssh-connections.html):
- Needs SSM Agent on the instance (3.0.222.0+ for port forwarding or SSH sessions). Instance needs outbound HTTPS 443 to
  `ssm.<region>`, `ssmmessages.<region>`, `ec2messages.<region>.amazonaws.com` (default SG egress allows this).
- Instance IAM role must include AWS managed policy `AmazonSSMManagedInstanceCore`.
- Local: AWS CLI plus the Session Manager plugin (1.1.23.0+ for SSH). Install plugin:
  https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
- Shell session: `aws ssm start-session --target i-XXXX`.
- SSH over SSM, add to `~/.ssh/config`, then `ssh -i key.pem ec2-user@i-XXXX`, ports can stay closed:
      Host i-* mi-*
          ProxyCommand sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'"
          User ec2-user
- VERIFIED: logging is not available for SSH or port-forwarding sessions.
- UNVERIFIED: SSM agent is preinstalled on AL2023 and Canonical's recent Ubuntu AMIs (I could not confirm from the
  fetched page). Still, the instance fails to show up in Fleet Manager without the role below.
- UNVERIFIED role+profile creation (these create IAM resources, reference only):
      aws iam create-role --role-name mhacks-ssm --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
      aws iam attach-role-policy --role-name mhacks-ssm --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
      aws iam create-instance-profile --instance-profile-name mhacks-ssm
      aws iam add-role-to-instance-profile --instance-profile-name mhacks-ssm --role-name mhacks-ssm
      # then run-instances ... --iam-instance-profile Name=mhacks-ssm
- Node + SSM (UNVERIFIED): spawn the proxy command yourself and pass its stdio as `sock` to ssh2; direct SSH is simpler.

## 7. Budget alarm
VERIFIED (https://docs.aws.amazon.com/cli/latest/reference/budgets/create-budget.html):
    aws budgets create-budget --account-id 111122223333 \
      --budget file://budget.json --notifications-with-subscribers file://notifications.json
budget.json (VERIFIED shape; trimmed to the essentials, the doc example also sets CostTypes and TimePeriod, which are optional, UNVERIFIED):
    {"BudgetName":"mhacks-monthly","BudgetType":"COST","TimeUnit":"MONTHLY","BudgetLimit":{"Amount":"10","Unit":"USD"}}
notifications.json (VERIFIED):
    [{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80,
       "ThresholdType":"PERCENTAGE","NotificationState":"OK"},
      "Subscribers":[{"SubscriptionType":"EMAIL","Address":"you@example.com"}]}]
Console (UNVERIFIED): Billing and Cost Management, Budgets, Create budget, "Zero spend budget" template is the
quickest. Gotcha: budgets and billing data lag many hours, so this is an alarm, not a brake. Credits count against
the budget unless `IncludeCredit` is false in CostTypes (VERIFIED the field exists; the example sets it true).

## 8. Terminate everything
VERIFIED (https://docs.aws.amazon.com/cli/latest/userguide/cli-services-ec2-instances.html): terminate is permanent;
charges stop once state is `shutting-down` or `terminated`. Stopped instances still bill for EBS.
    aws ec2 terminate-instances --instance-ids i-XXXX
    aws ec2 wait instance-terminated --instance-ids i-XXXX     # UNVERIFIED standard
    aws ec2 delete-security-group --group-id sg-XXXX           # VERIFIED, after the instance is gone
    aws ec2 delete-key-pair --key-name mhacks-demo             # VERIFIED
    rm mhacks-demo.pem
Also check (UNVERIFIED, standard): leftover EBS volumes (DeleteOnTermination is true for the root volume by default
but false for extra volumes you added), Elastic IPs (`aws ec2 describe-addresses`, release them; idle EIPs bill),
the IAM role/profile from section 6, any Bedrock long-term API key and its IAM user (section 9), and the budget.
Console: EC2 Global View (VERIFIED to exist in the EC2 free-tier doc) lists resources across regions.

## 9. Promotional and hackathon credits
- VERIFIED (https://aws.amazon.com/awscredits/): redeem at Billing console, Credits page
  (https://console.aws.amazon.com/billing/home#/credits), paste the promo code. You need an existing account.
- VERIFIED (https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html): credits apply
  automatically to eligible charges, soonest-expiring first, to the largest service charge first. The credit detail
  page shows Applicable products, Expiration date, Status (Active/Paused). Balance updates at the end of the billing
  cycle (the Estimated amount remaining field updates daily).
- VERIFIED: usually cover most services (EC2, S3, etc.) but each code lists designated services.
  NOT covered: AWS Marketplace, Savings Plans and RI upfront fees, Route 53 domain registration,
  premium support, training/certification, crypto mining. The fetched page notes third-party Bedrock models fall under
  the Marketplace restriction.
- VERIFIED: Bedrock docs say Anthropic and other third-party models are "offered and billed through AWS Marketplace"
  and charges show under the provider on your bill. UNVERIFIED and important: whether promo credits cover Claude on
  Bedrock depends on the code's service list. Check "Applicable products" on the credit before the demo. Amazon-owned
  models (Nova) are not Marketplace products (VERIFIED: Amazon models have no Marketplace product key), so credits
  are likelier to apply there. gpt-oss is listed under OpenAI with an open license and no Marketplace product ID on
  its model card (VERIFIED absence on the card), likely not Marketplace-billed, but UNVERIFIED.

## 10. Bedrock

### 10.1 Model access
VERIFIED (https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html):
- There is no longer a manual "request model access" step in commercial regions. All serverless foundation models are
  enabled by default; first invocation auto-subscribes in the background (up to 15 min, may fail meanwhile).
- Requirements: IAM `aws-marketplace:Subscribe`, `Unsubscribe`, `ViewSubscriptions` (AmazonBedrockFullAccess is the
  doc's recommended policy for the SDK/CLI path), and a valid payment method on the account.
- Anthropic only: one-time First Time Use form per account (or org management account). Submit in console by
  picking an Anthropic model in the catalog, or CLI:
      aws bedrock put-use-case-for-model-access --form-data <base64 of JSON>
      # JSON keys: companyName, companyWebsite, intendedUsers (0,1,2), industryOption, otherIndustryOption, useCases
      aws bedrock get-foundation-model-availability --model-id anthropic.claude-sonnet-5-5   # check AVAILABLE
  Individuals can use a GitHub or portfolio URL as the website. The form is not needed for Anthropic via bedrock-mantle.
- CLI needs v2.27.42 or later for these bedrock commands.
- AccessDeniedException right after granting perms can last about 2 minutes.

### 10.2 Auth: Bedrock API keys
VERIFIED (https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html):
- Console, Bedrock, API keys. Short-term: up to 12 h, tied to your console session. Long-term: pick expiry, creates an
  IAM user. Docs say long-term is for exploration only (fine for a demo, delete afterwards).
- Use: `export AWS_BEARER_TOKEN_BEDROCK=<key>` (boto3 and AWS SDKs pick it up), or header `Authorization: Bearer <key>`.
- JS short-term token generator: `npm install @aws/bedrock-token-generator`, `getTokenProvider()`.
- Delete long-term key: `aws iam delete-service-specific-credential --user-name bedrock-api-user --service-specific-credential-id ID`.

### 10.3 OpenAI-compatible endpoint (exists)
VERIFIED (https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html):
| Endpoint | Base URL | Auth |
|---|---|---|
| bedrock-runtime (recommended) | `https://bedrock-runtime.{region}.amazonaws.com/openai/v1` | SigV4 or Bedrock API key |
| bedrock-mantle | `https://bedrock-mantle.{region}.api.aws/v1` | Bedrock API key or AWS creds |
- Gotcha (VERIFIED): bedrock-runtime has NO `GET /models`; `client.models.list()` fails there. Mantle has it.
- Gotcha (VERIFIED): Model IDs differ by endpoint. gpt-oss-120b is `openai.gpt-oss-120b-1:0` on runtime and
  `openai.gpt-oss-120b` on mantle. gpt-oss on runtime supports Chat Completions but not Responses; mantle supports both.
- Claude models: Chat Completions and Responses are NOT supported on either endpoint per the Sonnet 5.5 and Haiku 4.5
  model cards (VERIFIED). Claude needs the Messages API (Anthropic format), Converse, or Invoke. So an
  OpenAI-SDK-based agent can reach gpt-oss on Bedrock but not Claude. Use the Anthropic SDK for Claude.
Working snippets (VERIFIED from AWS pages):
    # gpt-oss via OpenAI SDK, runtime endpoint
    export OPENAI_API_KEY=$AWS_BEARER_TOKEN_BEDROCK
    export OPENAI_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1
    curl -X POST "$OPENAI_BASE_URL/chat/completions" -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -d '{"model":"openai.gpt-oss-120b-1:0","messages":[{"role":"user","content":"Hello"}]}'
    # Claude via Converse over HTTP (from api-keys page; note the us. inference profile)
    curl -X POST "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-sonnet-4-6/converse" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $AWS_BEARER_TOKEN_BEDROCK" \
      -d '{"messages":[{"role":"user","content":[{"text":"Hello"}]}]}'
    # Claude via Anthropic SDK (Python, from model card): base_url ends in /anthropic, model is the profile ID
    Anthropic(base_url="https://bedrock-runtime.us-east-1.amazonaws.com/anthropic", api_key=token)
    client.messages.create(model="global.anthropic.claude-sonnet-5-5", max_tokens=1024, messages=[...])
UNVERIFIED: the Node equivalent is `new Anthropic({ baseURL: 'https://bedrock-runtime.us-east-1.amazonaws.com/anthropic',
apiKey: token })` with `@anthropic-ai/sdk`; also unverified is whether `AnthropicBedrock` classes accept the bearer key.

### 10.4 Model IDs seen in docs (model cards, 2026-10)
VERIFIED (https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html and per-model cards):
- Claude Sonnet 5.5 (launched 2026-09-28): runtime `us.`/`eu.`/`global.anthropic.claude-sonnet-5-5`; bare
  `anthropic.claude-sonnet-5-5` is the ID on mantle only (in-region runtime is "N/A"). Mantle Messages URL:
  `https://bedrock-mantle.{region}.api.aws/anthropic/v1/messages`.
- Claude Haiku 4.5: `global.anthropic.claude-haiku-4-5-20251001-v1:0` (also us./eu./au./jp./in.). Bare ID is not
  supported on runtime; mantle uses `anthropic.claude-haiku-4-5`.
- Claude Sonnet 4.6 (used in the api-keys page): `us.anthropic.claude-sonnet-4-6`.
- Enumerate others with `aws bedrock list-inference-profiles` (UNVERIFIED output shape).
- gpt-oss-120b / 20b: `openai.gpt-oss-120b-1:0`, `openai.gpt-oss-20b-1:0` (the 20b ID appears in the guardrail example).

### 10.5 Regions
VERIFIED from model cards:
- Claude Sonnet 5.5 on runtime: geo profiles (US) in us-east-1, us-east-2, us-west-1, us-west-2; global profile from
  almost every commercial region including all of the above; no in-region (non-profile) inference on runtime.
  On mantle it listed only us-gov-west-1.
- Claude Haiku 4.5 on mantle: in-region in us-east-1, us-east-2, us-west-2, eu-north-1, eu-west-1, ap-northeast-1,
  ap-southeast-4.
- gpt-oss-120b in-region: us-east-1, us-east-2, us-west-2, eu-central-1, eu-north-1, eu-south-1, eu-west-1,
  eu-west-2, ap-northeast-1, ap-south-1, ap-southeast-2/3/4, sa-east-1, us-gov-west-1. No geo/global profile.
- Safe demo pick: us-east-1 or us-west-2 for both the VM and Bedrock, and use a `global.` or `us.` Claude profile.
- Gotcha: global/geo profiles can route outside your region, so no single-region data residency (VERIFIED).

## Sources
All URLs are cited inline above (docs.aws.amazon.com CLI guide, AL2023 guide, EC2 free tier, Systems Manager Session Manager,
Budgets create-budget, Billing credits, aws.amazon.com/awscredits, Bedrock model-access, api-keys, inference-chat-completions,
model-cards and per-model cards, ubuntu.com/aws find-ubuntu-images, github.com/mscdex/ssh2).
