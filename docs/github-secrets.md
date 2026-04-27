# CI Secrets checklist

Add these in: Codemagic app -> Environment variables

- App path: `.`
- CI provider: `codemagic`
- Template: `bare`

## Required
- [ ] NODE_ENV
- [ ] APPLE_API_KEY_ID
- [ ] APPLE_API_ISSUER_ID
- [ ] APPLE_API_KEY_BASE64

## Recommended
- [ ] RELEASE_NOTES
- [ ] IOS_SCHEME
- [ ] IOS_WORKSPACE

Validate locally:
```bash
rn-ci-setup doctor
```

