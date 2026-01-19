export default {
  async fetch(request, env) {
    // 1. 配置信息 (请修改为你的实际信息)
    const OWNER = "mohicai";
    const REPO = "warp-exclude";
    const PATH = "exclude.txt";

    // 2. 构建 GitHub API 请求 (针对私有仓库)
    // 增加 timestamp 参数防止 GitHub API 缓存返回旧版本
    const githubApiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=main&t=${Date.now()}`;

    try {
      // 获取私有仓库内容
      const response = await fetch(githubApiUrl, {
        headers: {
          "Authorization": `token ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw", // 直接获取原始文本内容
          "User-Agent": "Cloudflare-Worker-Updater"
        }
      });

      if (!response.ok) {
        return new Response(`GitHub API Error: ${response.statusText}`, { status: response.status });
      }

      const text = await response.text();

      // 3. 格式化数据 (适配多种格式，去除端口)
      const excludeList = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
          // 匹配冒号前的部分：支持 stun.l.google.com 或 1.1.1.1
          const match = line.match(/^([^:\s/]+)/);
          const entry = match ? match[1] : null;

          if (!entry) return null;

          // 判断是 IP 还是 域名
          const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(entry);
          return isIP 
            ? { "address": `${entry}/32`, "description": "Private Repo Sync" }
            : { "host": entry, "description": "Private Repo Sync" };
        })
        .filter(item => item !== null);

      // 4. 提交到 Cloudflare API (默认策略)
      const cfApiUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/devices/policy/exclude`;
      
      const cfRes = await fetch(cfApiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(excludeList)
      });

      const cfData = await cfRes.json();

      return new Response(JSON.stringify({
        success: cfData.success,
        updated_count: excludeList.length,
        timestamp: new Date().toLocaleString()
      }), { headers: { "Content-Type": "application/json" } });

    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }
};