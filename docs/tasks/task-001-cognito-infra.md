# Task 001-Infra — AWS Cognito Infrastructure Provisioning

**Parent task:** [task-001-cognito-auth.md](task-001-cognito-auth.md)  
**Repo:** `w10n-config`  
**Module path:** `aws/opentofu/enx/`

---

## Goal

Provision the AWS Cognito resources required by task-001. The application task (`task-001-cognito-auth.md`) depends on the outputs of this module (User Pool ID, App Client IDs) to configure `enx-api`, `enx-ui`, and `enx-chrome`.

---

## Resources to Provision

1
### Module file layout

```
aws/opentofu/enx/
  providers.tf   # AWS provider + S3 backend (key: aws/enx/terraform.tfstate)
  variables.tf   # See Variables section below
  main.tf        # All resources above
  outputs.tf     # See Outputs section below
  README.md      # Resource inventory + architecture diagram
```

---

## Variables

| Variable                  | Type     | Description                              | Blocker?                                |
| ------------------------- | -------- | ---------------------------------------- | --------------------------------------- |
| `aws_region`              | `string` | AWS region, default `"us-east-1"`        | No                                      |
| `hosted_ui_domain_prefix` | `string` | Cognito domain prefix, e.g. `"enx-auth"` | No — must be globally unique            |
| `google_client_id`        | `string` | Google OAuth App client ID               | **Yes** — must be created first         |
| `google_client_secret`    | `string` | Google OAuth App client secret           | **Yes** — sensitive, passed via env var |
| `chrome_extension_id`     | `string` | Unpacked/published Chrome extension ID   | **Yes** — must be stable before apply   |

`google_client_secret` must be passed as `TF_VAR_google_client_secret` and never committed.

---

## Outputs

These values are consumed by `enx-api` (via k8s Secret `enx-cognito`) and by the client-side implementations.

| Output               | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| `user_pool_id`       | Cognito User Pool ID, e.g. `us-east-1_XXXXXXX`                                |
| `user_pool_arn`      | Cognito User Pool ARN                                                         |
| `ui_client_id`       | App Client ID for enx-ui                                                      |
| `chrome_client_id`   | App Client ID for enx-chrome                                                  |
| `hosted_ui_base_url` | `https://enx-auth.auth.us-east-1.amazoncognito.com`                           |
| `jwks_url`           | `https://cognito-idp.us-east-1.amazonaws.com/<pool-id>/.well-known/jwks.json` |

---

## External Dependencies (Blockers)

### 1. Google OAuth App

Must be created in Google Cloud Console before `tofu apply`:

1. Go to **APIs & Services → Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URIs:
   - `https://enx-auth.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
4. Note the **Client ID** and **Client Secret** — these become `google_client_id` and `TF_VAR_google_client_secret`

### 2. Chrome Extension ID

The Cognito App Client callback URL is locked to a specific extension ID. Use the extension's stable ID:

- **Unpacked (dev):** load in `chrome://extensions` with Developer Mode → copy the generated ID
- **Published:** ID is assigned by the Chrome Web Store and is permanent

If the extension is not yet published, use the dev ID for the initial provisioning and update when publishing.

---

## Apply Order

```
1. Google OAuth App created (manual, Google Cloud Console)
2. tofu init  (in aws/opentofu/enx/)
3. tofu plan  — review resources
4. tofu apply — provisions User Pool, Hosted UI domain, Google IdP, both App Clients
5. Capture outputs → create k8s Secret enx-cognito in homelab/k8s/
6. Update enx-api config.toml (dev) with output values
7. Update enx-ui and enx-chrome with hosted_ui_base_url and their respective client IDs
```

---

## User Pool Configuration Decisions

| Setting                    | Value                         | Reason                                                    |
| -------------------------- | ----------------------------- | --------------------------------------------------------- |
| `username_attributes`      | `["email"]`                   | Consistent with rssx pattern; no separate username        |
| `auto_verified_attributes` | `["email"]`                   | Cognito sends verification email automatically            |
| `case_sensitive` usernames | `false`                       | Prevent duplicate accounts differing only by case         |
| Password min length        | 8                             | Reasonable minimum; Google sign-in bypasses this          |
| Hosted UI domain type      | `amazoncognito.com` subdomain | Avoids ACM cert provisioning complexity for initial setup |

---

## App Client Configuration

Both clients share:
- `generate_secret = false` — public clients (PKCE, no client secret)
- `allowed_oauth_flows = ["code"]` — authorization code flow only
- `allowed_oauth_scopes = ["openid", "email", "profile"]`
- `allowed_oauth_flows_user_pool_client = true`
- `access_token_validity = 1` hour
- `refresh_token_validity = 30` days
- `prevent_user_existence_errors = "ENABLED"`
- `supported_identity_providers = ["COGNITO", "Google"]`

They differ only in `callback_urls` and `logout_urls`.

---

## Out of Scope

- Custom Cognito domain (requires ACM cert — future task if needed)
- GitHub or other social providers (future tasks)
- Cognito Lambda triggers (e.g. pre-signup, post-confirmation)
- AWS SES custom email sender (uses Cognito default sender for now)
- k8s Secret provisioning for `enx-cognito` (separate step after apply)

---

## Decisions

1. **Single User Pool, two App Clients.** One Google identity works across enx-ui and enx-chrome without re-login.
2. **`amazoncognito.com` subdomain for Hosted UI.** Avoids DNS and ACM complexity at this stage.
3. **State stored in S3.** Consistent with `ec2-tokyo` and `rssx` — bucket `wiloon-tofu-state`, key `aws/enx/terraform.tfstate`, region `ap-southeast-1`.
4. **`google_client_secret` is never committed.** Passed via `TF_VAR_google_client_secret` environment variable only.
