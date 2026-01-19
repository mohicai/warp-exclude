// ... 之前的代码
const cfRes = await fetch(cfApiUrl, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${env.CF_API_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(excludeList)
});

const cfData = await cfRes.json();

// 修改这里：如果失败，把 Cloudflare 的原生错误带出来
return new Response(JSON.stringify({
  success: cfData.success,
  cloudflare_errors: cfData.errors, // 关键：查看错误代码和信息
  updated_count: excludeList.length,
  timestamp: new Date().toLocaleString()
}), { headers: { "Content-Type": "application/json" } });
