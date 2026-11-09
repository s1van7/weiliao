/**
 * 应用更新领域服务：版本号、发布说明、三端安装包地址。
 *
 * 版本号唯一来源：仓库根 package.json 的 version（与 /api/health 一致）。
 * 安装包由发版脚本上传到 data/downloads，命名规则见 artifactOf()；
 * 文件不存在时对应平台返回 null，前端据此隐藏该平台的下载按钮（不给死链）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT_DIR } from '../db.js';

/** 安装包目录（与 server/index.js 的 /downloads 静态托管一致） */
const DOWNLOAD_DIR = path.join(DATA_DIR, 'downloads');

/**
 * 读取根 package.json 的版本号。
 * @returns {string}
 */
export function readAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 各版本发布说明（按版本号查表，缺失时返回空数组）。
 * 维护约定：每次发版在此追加一条，最早在前。
 */
const RELEASE_NOTES = Object.freeze({
  '1.1.11': [
    '设置页新增「检查更新」，可直接下载并安装最新版本',
    '通讯录好友按 A-Z 字母排序，右侧字母索引快速定位',
    '好友信息页支持「设为星标朋友」，星标好友在通讯录置顶',
    '私聊 / 群聊支持消息免打扰（不响铃、不弹通知）',
    '用户名（微聊号）支持修改，一年仅可修改一次',
    '置顶会话的列表底色加深，更易区分',
  ],
  '1.1.10': ['语音转文字统一输出简体中文', '四页支持左右滑动切换', '会话支持置顶 / 隐藏 / 删除 / 标记未读'],
});

/** 三端安装包的命名规则（与发版产物一致） */
const ARTIFACTS = Object.freeze([
  { platform: 'android', name: 'WeiLiao-Android', ext: '.apk', label: 'Android 版' },
  { platform: 'windows', name: 'WeiLiao-Setup', ext: '.exe', label: 'Windows 版' },
  { platform: 'ios', name: 'WeiLiao-iOS-Xcode', ext: '.zip', label: 'iOS 版（Xcode 工程）' },
]);

/**
 * 计算某平台某版本的安装包信息。
 * @param {{platform: string, name: string, ext: string, label: string}} artifact
 * @param {string} version
 * @returns {{platform: string, label: string, file: string, url: string, size: number}|null}
 */
function buildDownload(artifact, version) {
  const file = `${artifact.name}-${version}${artifact.ext}`;
  const absolute = path.join(DOWNLOAD_DIR, file);
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) return null;
    return {
      platform: artifact.platform,
      label: artifact.label,
      file,
      // 带版本参数：避免同名文件重传时命中 CDN / 浏览器旧缓存
      url: `/downloads/${file}?v=${encodeURIComponent(version)}`,
      size: Number(stat.size) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * 生成更新信息（供 GET /api/app/latest 与前端「检查更新」使用）。
 * @returns {{version: string, notes: string[], downloads: Array<Object>, released_at: number|null}}
 */
export function getLatestRelease() {
  const version = readAppVersion();
  const downloads = ARTIFACTS.map((artifact) => buildDownload(artifact, version)).filter(Boolean);

  let releasedAt = null;
  const android = downloads.find((item) => item.platform === 'android');
  if (android) {
    try {
      releasedAt = Math.round(fs.statSync(path.join(DOWNLOAD_DIR, android.file)).mtimeMs);
    } catch {
      releasedAt = null;
    }
  }

  return {
    version,
    notes: RELEASE_NOTES[version] ? [...RELEASE_NOTES[version]] : [],
    downloads,
    released_at: releasedAt,
  };
}

export default { readAppVersion, getLatestRelease };
