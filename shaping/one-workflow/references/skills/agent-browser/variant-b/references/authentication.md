# Authentication Patterns

Login flows, session persistence, OAuth, 2FA, and authenticated browsing.

**Related**: [cli-reference.md](cli-reference.md) for full command details, [SKILL.md](../SKILL.md) for quick start.

## Contents

- [Basic Login Flow](#basic-login-flow)
- [Saving Authentication State](#saving-authentication-state)
- [Restoring Authentication](#restoring-authentication)
- [OAuth / SSO Flows](#oauth--sso-flows)
- [Two-Factor Authentication](#two-factor-authentication)
- [HTTP Basic Auth](#http-basic-auth)
- [Cookie-Based Auth](#cookie-based-auth)
- [Token Refresh Handling](#token-refresh-handling)
- [Security Best Practices](#security-best-practices)

## Basic Login Flow

```bash
# Navigate to login page
agent-browser open https://app.example.com/login --session auth
agent-browser wait --load networkidle --session auth

# Get form elements
agent-browser snapshot -i --session auth
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Sign In"

# Fill credentials
agent-browser fill @e1 "user@example.com" --session auth
agent-browser fill @e2 "password123" --session auth

# Submit
agent-browser click @e3 --session auth
agent-browser wait --load networkidle --session auth

# Verify login succeeded
agent-browser get url --session auth  # Should be dashboard, not login
```

## Saving Authentication State

After logging in, save state for reuse:

```bash
# Login first (see above), then save authenticated state
agent-browser state save ./auth-state.json --session auth
```

## Restoring Authentication

Skip login by loading saved state:

```bash
# Load saved auth state
agent-browser state load ./auth-state.json --session auth

# Navigate directly to protected page
agent-browser open https://app.example.com/dashboard --session auth

# Verify authenticated
agent-browser snapshot -i --session auth
```

## OAuth / SSO Flows

For OAuth redirects:

```bash
# Start OAuth flow
agent-browser open https://app.example.com/auth/google --session auth

# Handle redirects automatically
agent-browser wait --url "**/accounts.google.com**" --session auth
agent-browser snapshot -i --session auth

# Fill Google credentials
agent-browser fill @e1 "user@gmail.com" --session auth
agent-browser click @e2 --session auth  # Next button
agent-browser wait 2000 --session auth
agent-browser snapshot -i --session auth
agent-browser fill @e3 "password" --session auth
agent-browser click @e4 --session auth  # Sign in

# Wait for redirect back
agent-browser wait --url "**/app.example.com**" --session auth
agent-browser state save ./oauth-state.json --session auth
```

## Two-Factor Authentication

Handle 2FA with manual intervention:

```bash
# Login with credentials using headed mode (visible browser)
agent-browser open https://app.example.com/login --headed --session auth
agent-browser snapshot -i --session auth
agent-browser fill @e1 "user@example.com" --session auth
agent-browser fill @e2 "password123" --session auth
agent-browser click @e3 --session auth

# Wait for user to complete 2FA manually
echo "Complete 2FA in the browser window..."
agent-browser wait --url "**/dashboard" --timeout 120000 --session auth

# Save state after 2FA
agent-browser state save ./2fa-state.json --session auth
```

## HTTP Basic Auth

For sites using HTTP Basic Authentication:

```bash
# Set credentials before navigation
agent-browser set credentials username password --session auth

# Navigate to protected resource
agent-browser open https://protected.example.com/api --session auth
```

## Cookie-Based Auth

Manually set authentication cookies:

```bash
# Set auth cookie
agent-browser cookies set session_token "abc123xyz" --session auth

# Navigate to protected page
agent-browser open https://app.example.com/dashboard --session auth
```

## Token Refresh Handling

For sessions with expiring tokens:

```bash
STATE_FILE="./auth-state.json"

# Try loading existing state
if [[ -f "$STATE_FILE" ]]; then
    agent-browser state load "$STATE_FILE" --session auth
    agent-browser open https://app.example.com/dashboard --session auth

    # Check if session is still valid
    URL=$(agent-browser get url --session auth)
    if [[ "$URL" == *"/login"* ]]; then
        echo "Session expired, re-authenticating..."
        agent-browser snapshot -i --session auth
        agent-browser fill @e1 "$USERNAME" --session auth
        agent-browser fill @e2 "$PASSWORD" --session auth
        agent-browser click @e3 --session auth
        agent-browser wait --url "**/dashboard" --session auth
        agent-browser state save "$STATE_FILE" --session auth
    fi
else
    # First-time login
    agent-browser open https://app.example.com/login --session auth
    # ... login flow ...
fi
```

## Security Best Practices

1. **Never commit state files** — they contain session tokens
   ```bash
   echo "*.auth-state.json" >> .gitignore
   ```

2. **Use environment variables for credentials**
   ```bash
   agent-browser fill @e1 "$APP_USERNAME" --session auth
   agent-browser fill @e2 "$APP_PASSWORD" --session auth
   ```

3. **Clean up after automation**
   ```bash
   agent-browser cookies clear --session auth
   rm -f ./auth-state.json
   agent-browser close --session auth
   ```

4. **Use short-lived sessions for CI/CD**
   ```bash
   # Don't persist state in CI
   agent-browser open https://app.example.com/login --session ci
   # ... login and perform actions ...
   agent-browser close --session ci  # Session ends, nothing persisted
   ```
