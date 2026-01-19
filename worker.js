export default {
  async fetch(request, env) {
    const OWNER = "mohicai"; // 根据你的截图修正
    const REPO = "warp-exclude"; 
    const PATH = "exclude.txt";

    try {
      // 1. 获取 GitHub 私有仓库文件
      const githubApiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=main&t=${Date.now()}`;
      const githubRes = await fetch(githubApiUrl, {
        headers: {
          "Authorization": `token ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "Cloudflare-Worker-Updater"
        }
      });

      if (!githubRes.ok) {
        throw new Error(`GitHub 访问失败: ${githubRes.status} ${githubRes.statusText}`);
      }

      const text = await githubRes.text();

      // 2. 格式化数据并剔除无效项
      const excludeList = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
          const match = line.match(/^([^:\s/]+)/);
          const entry = match ? match[1] : null;
          if (!entry) return null;

          const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(entry);
          return isIP 
            ? { "address": `${entry}/32`, "description": "Auto-sync" }
            : { "host": entry, "description": "Auto-sync" };
        })
        .filter(item => item !== null);

      // 3. 提交到 Cloudflare
      const cfApiUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/devices/policy/exclude`;
      
      const cfRes = await fetch(cfApiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(excludeList)
      });

      // 4. 解析 CF 响应（这是最容易报 1101 的地方，增加一层判断）
      const cfText = await cfRes.text();
      let cfData;
      try {
        cfData = JSON.parse(cfText);
      } catch (e) {
        throw new Error(`Cloudflare API 返回非 JSON 格式: ${cfText}`);
      }

      return new Response(JSON.stringify({
        success: cfData.success,
        cloudflare_response: cfData, // 直接透传完整的错误信息
        updated_count: excludeList.length
      }), { 
        headers: { "Content-Type": "application/json" } 
      });

    } catch (err) {
      // 如果报错，直接返回具体的错误信息，这样 Webhook 页面就能看到了
      return new Response(JSON.stringify({
        error: "Worker 内部逻辑崩溃",
        message: err.message,
        stack: err.stack
      }), { 
        status: 200, // 设为 200 方便在 GitHub 预览 Response Body
        headers: { "Content-Type": "application/json" } 
      });
    }
  }
};
