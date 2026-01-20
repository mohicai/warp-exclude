export default {
  async fetch(request, env) {
    const OWNER = "mohicai"; 
    const REPO = "warp-exclude"; 
    const PATH = "exclude.txt";
    const CF_ACCOUNT_ID = "3645576ee7e7464ea5d5caee7645a2cc";

    // 环境变量检查 (CF_ACCOUNT_ID 已经硬编码，所以只检查 Token)
    if (!env.CF_API_TOKEN || !env.GITHUB_TOKEN) {
      return new Response(JSON.stringify({ error: "Cloudflare or GitHub Token missing in Environment Variables" }), { status: 200 });
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
        .map(line => {
          // 1. 去掉行末尾的注释（即去掉 # 及其后面的所有内容）
          // 2. 去掉首尾空格
          return line.split('#')[0].trim();
        })
        // 3. 过滤掉空行（原本就是注释行或者全是空格的行，在上面处理后会变成空字符串）
        .filter(line => line !== "")
        .map(line => {
          let entry = line;
          
          // --- 解析域名/IP及端口 ---
          if (line.includes(']:')) {
             entry = line.split(']:')[0].replace('[', ''); 
          } else if (!line.includes(':') || (line.match(/:/g) || []).length === 1) {
             entry = line.split(':')[0];
          } 

          const isIPv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}($|\/)/.test(entry);
          const isIPv6 = /:/.test(entry); 

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
      const cfApiUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/devices/policy/exclude`;
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
        preview: excludeList.slice(-3) 
      }));

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 200 });
    }
  }
};