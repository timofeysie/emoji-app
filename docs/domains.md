# Domains and URLs

This app is deployed on **AWS App Runner** (see [deployments.md](./deployments.md)).
Use this guide to find the **default service URL** and optionally attach a **custom
domain**.

---

## Find your current deployed URL (default domain)

### AWS Management Console

1. Sign in to the [AWS Management Console](https://console.aws.amazon.com/).
2. Open **App Runner** (search the top bar).
3. Confirm the **Region** matches where you created the service (e.g. **Asia Pacific
   (Sydney)** `ap-southeast-2`).
4. Under **Services**, click your service (e.g. **emoji-app**).
5. On the service **dashboard**, find **Default domain**.  
   It looks like  
   `https://<random-id>.ap-southeast-2.awsapprunner.com`  
   — that is the public HTTPS URL of your app. Use **Open app** if shown.

You can copy that URL for bookmarks, Cognito **callback** / **sign-out** URLs, and
sharing.

### AWS CLI

List services in the region:

```bash
aws apprunner list-services --region ap-southeast-2
```

Note the `ServiceArn` for your service, then describe it (paste your real ARN from
`list-services`):

**One line** (works in **bash**, **PowerShell**, and **cmd**):

```bash
aws apprunner describe-service --service-arn "arn:aws:apprunner:ap-southeast-2:<account-id>:service/<service-name>/<id>" --region ap-southeast-2 --query "Service.ServiceUrl" --output text
```

In **PowerShell**, do **not** use `\` at the end of lines (that is a **bash** habit);
`\` breaks the command. Use a single line as above, or continue lines with a **backtick**
`` ` ``:

```powershell
aws apprunner describe-service `
  --service-arn "arn:aws:apprunner:ap-southeast-2:<account-id>:service/<service-name>/<id>" `
  --region ap-southeast-2 `
  --query "Service.ServiceUrl" `
  --output text
```

The output is the hostname (no scheme). Your app URL is  
`https://<that-hostname>`.

---

## Custom domain for App Runner

App Runner can serve your app on your own hostname (e.g. `app.example.com`) using
**AWS Certificate Manager (ACM)** for TLS and **DNS** (often **Route 53**) for routing.

Official reference:  
[Managing custom domain names for an App Runner service](https://docs.aws.amazon.com/apprunner/latest/dg/manage-custom-domains.html).

### Prerequisites

- A **domain** you control (registered in Route 53 or elsewhere).
- DNS hosted where you can add **validation** and **routing** records (Route 53
  hosted zone is the smoothest path).
- An **ACM certificate** in the **same AWS Region as the App Runner service**
  (e.g. `ap-southeast-2`) that covers the hostname (e.g. `app.example.com` or
  `*.example.com`). Request the certificate in **ACM** in that region, complete
  **DNS validation** (ACM gives you CNAME records to add).

### High-level steps

1. In **ACM** (correct region), **Request** a public certificate for your FQDN (or
   wildcard). Add ACM’s **DNS validation** CNAMEs to your DNS zone until the
   certificate status is **Issued**.
2. In **App Runner** → your **service** → **Custom domains** (or **Networking** /
   **Custom domain**, depending on console layout) → **Link domain** / **Add domain**.
3. Enter your hostname (e.g. `app.example.com`) and choose the **ACM certificate**.
4. App Runner shows **DNS targets** (CNAME or alias instructions). In **Route 53**,
   create the record it specifies — for Route 53, an **alias** to the App Runner
   service is often supported; otherwise use the **CNAME** values App Runner provides.
   See also  
   [Routing traffic to an App Runner service](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-app-runner.html).
5. Wait until the custom domain status in App Runner is **active** / **Certificate
   validated** (can take up to tens of minutes after DNS propagates).
6. **Update Amazon Cognito** for this app: in your app client’s **callback** and
   **sign-out** URLs, add the **custom** URLs in addition to localhost and the default
   App Runner URL, for example:
   - `https://app.example.com/auth/callback`
   - `https://app.example.com/`  
   Paths and scheme must match what the app sends (`/auth/callback`, no trailing
   slash on the callback unless you change the app).
7. **Rebuild and redeploy** is **not** required for DNS alone: the SPA uses
   `window.location.origin` for OAuth redirects, so the same image works on the new
   hostname once Cognito allowlists it.

### Notes

- **apex domain** (`example.com` without `www`): often needs **Route 53 alias** (or
  ALB patterns); check App Runner’s current docs for root-domain support vs
  subdomain-only.
- Keep the **default** `*.awsapprunner.com` URL valid for debugging unless you remove
  it from Cognito; you can allow **multiple** callback URLs on one app client.
- If TLS or DNS validation fails, use App Runner’s **Custom domains** page for
  specific error messages and required record values.
