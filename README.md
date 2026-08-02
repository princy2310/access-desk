# AccessDesk - AI powered IT self-service portal

## Demo

[Watch the video](https://www.youtube.com/watch?v=XM2j-hruy2k)

## Write-up

[Build Your Own AI-Powered IT Self-Service Portal](https://princygandhi.substack.com/p/build-your-own-ai-powered-it-self) covers the architecture and why the rules engine, not the language model, owns every access decision.



AI-powered IT self-service portal that automates software access provisioning. Built with Node.js, Express, and Amazon Bedrock (Claude), it features an access agent that auto-grants or escalates requests based on job-level policies, an LLM chat assistant for natural language tool discovery and employee lookups, a rules engine with configurable per-tool approval chains, secure token-based approval workflows with email notifications, dual portals (employee self-service + manager approval dashboard), real-time request lifecycle tracking, and a DynamoDB-backed data layer with CDK infrastructure for production deployment on AWS.

## AI Components

### 1. Access Agent (`access-agent.js`)
The decision engine. When an employee requests software, the agent checks the rules and either grants access or escalates:
- **Auto-grant**: If the employee's job level matches the tool's eligibility list, the agent approves and provisions access instantly - no human in the loop
- **Escalate**: If the employee isn't eligible or the tool always requires approval, the agent generates a secure token, records the decision reason, and triggers a notification to the designated approver

Every decision includes a human-readable explanation (e.g., "Job level 'intern' not eligible for auto-grant of Camtasia").

### 2. LLM Chat Assistant (`/api/chat` + `llm.js`)
A conversational interface on both portals powered by Amazon Bedrock (Claude). The chat endpoint sends the full software catalog, employee profile, pending requests, and employee lookup results as context to Claude, which generates natural language responses.

**Requires**: AWS credentials with Bedrock access (`aws configure` or env vars). Model: `anthropic.claude-3-haiku-20240307-v1:0` (configurable via `BEDROCK_MODEL_ID` env var).

**For employees:**
- Tool discovery - "I need to record my screen" → Claude recommends Camtasia with context about eligibility
- Availability check - "What tools can I install?" → Claude lists tools based on the employee's job level
- Status check - "What approvals are pending?" → Claude reports pending requests with approver names

**For managers:**
- Employee lookup by name - "Who is Princy?" → Claude returns job level, department, email, software cost
- Contextual answers - "Should I approve this Camtasia request for an intern?" → Claude reasons about policy

### 3. Rules Engine (`rules-engine.js`)
Deterministic policy evaluation:
- Checks `requiresApprovalAlways` flag first (e.g., Adobe Creative Cloud always needs human review)
- Checks employee job level against the tool's `autoGrantJobLevels` list
- Returns a structured decision with reason, approver ID, and approver name

### LLM Configuration
The chat assistant requires AWS credentials with Amazon Bedrock access. Set up with `aws configure` or environment variables:
- `AWS_REGION` - default: `us-east-1`
- `BEDROCK_MODEL_ID` - default: `anthropic.claude-3-haiku-20240307-v1:0`

## Features

**Employee Portal** - Software catalog with categories, search, real product icons. Install button for eligible tools, Request Approval for others. Pending requests show "Requested" with approver name. History view. AI chat.

**Manager Portal** - Pending approvals queue showing requester name, job level, reason. Approve/reject with reason modal. Resolved requests view. AI chat for employee lookups by name.

**Security** - Approval tokens are 32-byte cryptographically random hex strings with 72-hour expiry. DynamoDB conditional updates prevent concurrent approve/reject race conditions. Status transitions are validated (no skipping steps).

**Email Notifications** - In production, sends approval emails via Amazon SES with tokenized approve/reject links. Locally, email events are logged to the console.

**Persistence** - Local dev uses in-memory store with JSON file persistence (survives restarts). Production option uses DynamoDB.

**Follow-up reminders** - A Lambda (`src/lambda/reminder-handler.js`) sweeps every 15 minutes and
re-sends the approval email for requests still sitting in `pending_approval`, up to
`MAX_APPROVAL_REMINDERS` (3) times.

Reminder timing derives from `createdAt` and the `reminders` counter rather than `updatedAt`, so the
schedule is deterministic and unaffected by other writes: the *n*th reminder is due at
`createdAt + (n × followUpWindow)`. The window is configured in **minutes** via the `followUpWindow`
SSM parameter (default 60, clamped between 15 and 4320), so a request left unanswered is nudged at +60, +120,
and +180 minutes, then left alone.

Requests are skipped when the reminder limit is reached, the approval token has already expired
(the approve/reject links would be dead), or no approver is recorded. The counter is only incremented
after SES reports a successful send, so a failed email is retried on the next sweep rather than
silently consuming an attempt.

## Architecture

The CDK stack (`infra/lib/access-desk-stack.ts`) provisions:

- **Amazon DynamoDB** - a single `TicketsTable` with composite `PK`/`SK` string keys, plus a global
  secondary index on `status` and `createdAt` so the manager queue can query pending requests without a
  table scan
- **Amazon ECS on AWS Fargate** - 512 MiB memory, 256 CPU units, container port 3000, desired count 1.
  The image is built locally at deploy time via `ContainerImage.fromAsset`, so Docker must be running.
- **Application Load Balancer** - fronts the Fargate service. The stack exports its DNS name as the
  `AlbDnsName` output.
- **AWS Systems Manager Parameter Store** - runtime configuration held outside the image: access
  catalog, default approver, follow-up window, provider type, SES sender address, and portal base URL.
  The application reads these at runtime and caches them for 5 minutes, so changes take effect without
  a rebuild or redeploy.
- **AWS Lambda + Amazon EventBridge** - the follow-up reminder function (Node.js 20, 256 MB, 60s
  timeout) on a 15-minute schedule. Its code asset is the repository root, so run `npm install` at the
  root before `cdk deploy`: the handler reaches `store.js`, which depends on `uuid`.
- **AWS IAM** - the Fargate task role and reminder Lambda each get `ssm:GetParameter*` scoped to the
  `access-desk/*` parameter path, plus `bedrock:InvokeModel` and `ses:SendEmail` / `ses:SendRawEmail`.
  DynamoDB access is granted with `table.grantReadWriteData`, so it is scoped to the table.

Stack outputs: `TableName`, `TableArn`, `SsmParameterPrefix`, `AlbDnsName`.

## Deploy

Requires Node.js 20 or later (the container builds from `node:20-alpine`), the AWS CDK, and a running
Docker daemon.

```bash
# Run locally first - no AWS resources needed, email events log to console
npm install
npm run dev

# Run the test suite (Vitest, including property-based tests via fast-check)
npm test

# Deploy
cd infra
npm install
npx cdk bootstrap    # first time in this account/Region only
npx cdk deploy
```

After deploying, populate the Parameter Store values under the prefix from `SsmParameterPrefix`. The
portal base URL is used to build approval links in outbound email, so it must be an address approvers
can actually reach.

To tear down: `cd infra && npx cdk destroy`.

**Cost note:** this stack is not serverless and bills while idle. The VPC is created with
`natGateways: 1`, and a NAT Gateway carries an hourly charge plus data processing regardless of
traffic. The Application Load Balancer and the always-on Fargate task (`desiredCount: 1`) also bill
continuously. Destroy the stack when you are not using it.

