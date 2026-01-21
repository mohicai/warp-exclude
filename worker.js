export default {
  async fetch(request, env) {
    const OWNER = "mohicai";
    const REPO = "warp-exclude";
    const CF_ACCOUNT_ID = "3645576ee7e7464ea5d5caee7645a2cc";

    if (!env.CF_API_TOKEN || !env.GITHUB_TOKEN) {
      return new Response(JSON.stringify({ error: "Tokens missing" }), { status: 200 });
    }

    // 辅助函数：解析文本行并转换为 CF 格式
    const parseLines = (text) => {
      return text.split('\n')
        .map(line => line.split('#')[0].trim())
        .filter(line => line !== "")
        .map(line => {
          let entry = line;
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
        });
    };

    // 辅助函数：从 GitHub 获取文件内容
    const fetchGithubFile = async (path) => {
      const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=main&t=${Date.now()}`;
      const res = await fetch(url, {
        headers: {
          "Authorization": `token ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "Cloudflare-Worker-Updater"
        }
      });
      return res.ok ? await res.text() : null;
    };

    try {
      let finalExcludeList = [];

      // 1. 获取并处理 exclude.txt
      const excludeText = await fetchGithubFile("exclude.txt");
      if (excludeText) {
        finalExcludeList = finalExcludeList.concat(parseLines(excludeText));
      }

      // 2. 获取并处理 exclude_url.txt
      const urlListText = await fetchGithubFile("exclude_url.txt");
      if (urlListText) {
        // 解析出所有有效的 URL
        const urls = urlListText.split('\n')
          .map(line => line.split('#')[0].trim())
          .filter(line => line.startsWith('http'));

        // 并发抓取所有 URL 的内容
        const urlResponses = await Promise.all(
          urls.map(url => fetch(url).then(r => r.ok ? r.text() : "").catch(() => ""))
        );

        // 处理每个 URL 返回的文本
        urlResponses.forEach(text => {
          if (text) {
            finalExcludeList = finalExcludeList.concat(parseLines(text));
          }
        });
      }

      // 3. 去重（防止不同来源有重复项）
      const uniqueList = Array.from(new Map(finalExcludeList.map(item => [item.address || item.host, item])).values());

      // 4. 提交到 Cloudflare
      const cfApiUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/devices/policy/exclude`;
      const cfRes = await fetch(cfApiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(uniqueList)
      });

      const cfData = await cfRes.json();
      return new Response(JSON.stringify({
        success: cfData.success,
        total_count: uniqueList.length,
        sources: {
          exclude_txt: !!excludeText,
          external_urls_fetched: urlListText ? "checked" : "none"
        },
        preview: uniqueList.slice(0, 5)
      }));

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 200 });
    }
  }
};
