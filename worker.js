export default {
  async fetch(request, env) {
    const OWNER = "mohicai"; 
    const REPO = "warp-exclude"; 
    const PATH = "exclude.txt";
    const CF_ACCOUNT_ID= "3645576ee7e7464ea5d5caee7645a2cc"
    // 环境变量前置检查
    if (!CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.GITHUB_TOKEN) {
      return new Response(JSON.stringify({ error: "Environment variables missing" }), { status: 200 });
    }

    try {
      const githubApiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=main&t=${Date.now()}`;
      const githubRes = await fetch(githubApiUrl, {
        headers: {
          "Authorization": `token ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "Cloudflare-Worker-Updater"
        }
      });

      if (!githubRes.ok) throw new Error(`GitHub Error: ${githubRes.status}`);
      const text = await githubRes.text();

      const excludeList = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
          // --- 改进的解析逻辑 ---
          let entry = line;
          
          // 如果包含端口号 (针对域名或 IPv4:端口)
          // 注意：IPv6 的端口通常在 [] 外面，如 [2409::]:3478
          if (line.includes(']:')) {
             entry = line.split(']:')[0].replace('[', ''); // 提取 [IPv6]
          } else if (!line.includes(':') || (line.match(/:/g) || []).length === 1) {
             // 只有0个或1个冒号，认为是 域名:端口 或 IPv4:端口
             entry = line.split(':')[0];
          } 
          // 如果是纯 IPv6 (多个冒号且没端口)，entry 保持原样

          // 判断是否为 IP (包含 IPv4 或 IPv6 特征)
          const isIPv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}($|\/)/.test(entry);
          const isIPv6 = /:/.test(entry); // 简单的 IPv6 判断：包含冒号

          if (isIPv4 || isIPv6) {
            return { 
              "address": entry.includes('/') ? entry : `${entry}${isIPv4 ? '/32' : '/128'}`, 
              "description": "Auto-sync IP" 
            };
          } else {
            return { "host": entry, "description": "Auto-sync Domain" };
          }
        })
        .filter(item => item !== null);

      // 提交到 Cloudflare
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
        cloudflare_response: cfData,
        updated_count: excludeList.length,
        preview: excludeList.slice(-3) // 显示最后三项确认格式
      }));

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 200 });
    }
  }
};
