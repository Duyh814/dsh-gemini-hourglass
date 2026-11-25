/**
 * [INPUT]: 依赖 node:child_process、node:fs、node:os、node:path 操作 ~/.dsh/profiles/desktop
 * [OUTPUT]: 提供 CLI 命令 install / uninstall，自动将 dsh-ntr-quota 注册或移除出 DeepSeek Harness 桌面端 Profile
 * [POS]: scripts/ 本地部署工具，免去手动编辑 package.json 与执行 pnpm add 的重复步骤
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(__dirname, '..')
const PLUGIN_NAME = 'dsh-ntr-quota'
const PROFILE_DIR = path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
const PROFILE_PKG = path.join(PROFILE_DIR, 'package.json')
const MAC_DSH_CLI = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'

function resolveDshCli() {
  if (fs.existsSync(MAC_DSH_CLI)) return MAC_DSH_CLI
  return 'dsh'
}

function readProfilePkg() {
  if (!fs.existsSync(PROFILE_PKG)) {
    throw new Error(`未找到 DeepSeek Harness 桌面端 Profile：${PROFILE_PKG}`)
  }
  return JSON.parse(fs.readFileSync(PROFILE_PKG, 'utf8'))
}

function writeProfilePkg(pkg) {
  const tmp = `${PROFILE_PKG}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, PROFILE_PKG)
}

function runPluginCmd(args) {
  const cli = resolveDshCli()
  execFileSync(cli, ['plugin', '--profile', 'desktop', ...args], {
    stdio: 'inherit',
  })
}

function install() {
  console.log(`[dsh-ntr-quota] 正在安装本地插件：${PLUGIN_DIR}`)
  runPluginCmd(['add', `file:${PLUGIN_DIR}`])

  const pkg = readProfilePkg()
  pkg.dsh ??= {}
  pkg.dsh.profile ??= {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  if (!bundles.includes(PLUGIN_NAME)) {
    bundles.push(PLUGIN_NAME)
    pkg.dsh.profile.bundles = bundles
    writeProfilePkg(pkg)
    console.log(`[dsh-ntr-quota] 已将 "${PLUGIN_NAME}" 写入 ${PROFILE_PKG} 的 dsh.profile.bundles`)
  } else {
    console.log(`[dsh-ntr-quota] "${PLUGIN_NAME}" 已存在于 dsh.profile.bundles`)
  }
  console.log('[dsh-ntr-quota] 安装完成，请重启 DeepSeek Harness 或等待插件热重载生效。')
}

function uninstall() {
  const pkg = readProfilePkg()
  const bundles = Array.isArray(pkg.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  if (bundles.includes(PLUGIN_NAME)) {
    pkg.dsh.profile.bundles = bundles.filter(name => name !== PLUGIN_NAME)
    writeProfilePkg(pkg)
    console.log(`[dsh-ntr-quota] 已从 ${PROFILE_PKG} 的 dsh.profile.bundles 移除 "${PLUGIN_NAME}"`)
  }
  try {
    runPluginCmd(['remove', PLUGIN_NAME])
  } catch {
    console.log(`[dsh-ntr-quota] pnpm 未安装 "${PLUGIN_NAME}"，跳过移除步骤`)
  }
  console.log('[dsh-ntr-quota] 卸载完成。')
}

const action = process.argv[2] ?? 'install'
if (action === 'install') install()
else if (action === 'uninstall') uninstall()
else {
  console.error('用法：node scripts/install-desktop.mjs [install|uninstall]')
  process.exit(1)
}
