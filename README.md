# rn-ci-setup

CLI to scaffold React Native CI/CD using GitHub Actions and Fastlane.

## Usage

```bash
npx rn-ci-setup init
```

Flags:

- `--ci-provider <github|bitrise|codemagic>`: choose generated CI config
- `--android`: generate Android workflow + Fastlane
- `--ios`: generate iOS workflow + Fastlane
- `--expo` / `--bare`: choose template mode
- `--firebase`: generate Firebase App Distribution lane
- `--playstore`: generate Play Store deploy lane
- `--testflight`: generate TestFlight deploy lane
- `--app-path <path>`: target RN app directory in monorepos

Examples:

```bash
npx rn-ci-setup init --ci-provider github --android --ios
npx rn-ci-setup init --ci-provider bitrise --android --ios
npx rn-ci-setup init --ci-provider codemagic --ios --testflight
npx rn-ci-setup init --android
npx rn-ci-setup init --android --expo --firebase --playstore
npx rn-ci-setup init --ios --testflight --app-path apps/mobile
```

## Generated files

- `.github/workflows/android.yml` (GitHub provider)
- `.github/workflows/ios.yml` (GitHub provider)
- `bitrise.yml` (Bitrise provider)
- `codemagic.yaml` (Codemagic provider)
- `android/fastlane/Fastfile`
- `ios/fastlane/Fastfile`
- `.env.example`
- `.env.production`
- `docs/github-secrets.md`
- `.rn-ci-setup.json`

## Doctor command

Validate required secrets and env values:

```bash
npx rn-ci-setup doctor
```

It checks `.env.production`, `.env.example`, and shell env vars against the setup profile.

## Local development

```bash
npm install
npm run init -- --android --ios
npm run doctor
```
