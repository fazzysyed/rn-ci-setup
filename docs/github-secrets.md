# CI Secrets checklist

Add these in: GitHub repo -> Settings -> Secrets and variables -> Actions

- App path: `.`
- CI provider: `github`
- Template: `bare`

## Required
- [ ] NODE_ENV
- [ ] ANDROID_KEYSTORE_BASE64
- [ ] ANDROID_KEYSTORE_PASSWORD
- [ ] ANDROID_KEY_ALIAS
- [ ] ANDROID_KEY_PASSWORD
- [ ] APPLE_API_KEY_ID
- [ ] APPLE_API_ISSUER_ID
- [ ] APPLE_API_KEY_BASE64
- [ ] APPLE_ID
- [ ] APPLE_TEAM_ID
- [ ] APP_STORE_CONNECT_TEAM_ID
- [ ] APPLE_APP_IDENTIFIER
- [ ] MATCH_GIT_URL
- [ ] MATCH_PASSWORD
- [ ] SLACK_WEBHOOK_URL
- [ ] DISCORD_WEBHOOK_URL
- [ ] TEAMS_WEBHOOK_URL

## Recommended
- [ ] IOS_SCHEME
- [ ] IOS_WORKSPACE

Create GitHub secrets automatically:
```bash
rn-ci-setup secrets
```


Validate locally:
```bash
rn-ci-setup doctor
```

