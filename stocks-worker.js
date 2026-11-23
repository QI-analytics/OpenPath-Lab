// Open Path Labs: stock data server (Cloudflare Worker). Keeps your API keys secret.
// Setup: Workers & Pages > Create > Worker > paste this file > Deploy.
// Settings > Variables and Secrets: add secrets TWELVE_KEY (required) and FINNHUB_KEY (optional, for company details),
// plus the variable ALLOWED_ORIGIN = your website address. Then paste this Worker's URL into MK.proxy in index.html.
// Endpoints: /series?symbol=AAPL&range=daily|intraday   /profile?symbol=AAPL   /search?q=apple   /news?symbol=AAPL   /earnings?symbol=AAPL

// ---- shared market data helpers (used by the page and by stocks-worker.js) ----
const TDURL="https://api.twelvedata.com/",FHURL="https://finnhub.io/api/v1/";
async function getJSON(u){const r=await fetch(u);if(!r.ok&&![401,403,429].includes(r.status))throw new Error("HTTP "+r.status);return r.json()}
async function tdSeries(t,key,intraday){const j=await getJSON(`${TDURL}time_series?symbol=${encodeURIComponent(t)}&interval=${intraday?"5min":"1day"}&outputsize=${intraday?78:1300}&apikey=${key}`);if(j.status==="error"||!j.values)throw new Error(j.message||"No data");return j.values.slice().reverse().map(v=>({d:+new Date(v.datetime.length>10?v.datetime.replace(" ","T"):v.datetime),o:+v.open,h:+v.high,l:+v.low,c:+v.close}))}
async function tdSearch(q,key){const j=await getJSON(`${TDURL}symbol_search?symbol=${encodeURIComponent(q)}&outputsize=10&apikey=${key}`);return(j.data||[]).filter(x=>/Common Stock|ETF/.test(x.instrument_type||"")).filter((x,i,a)=>a.findIndex(y=>y.symbol===x.symbol)===i).slice(0,6).map(x=>[x.symbol,x.instrument_name])}
async function fhSearch(q,key){const j=await getJSON(`${FHURL}search?q=${encodeURIComponent(q)}&token=${key}`);return(j.result||[]).filter(x=>!String(x.symbol).includes(".")&&/Common Stock|ETP|ETF/.test(x.type||"")).slice(0,6).map(x=>[x.symbol,x.description])}
async function fhProfile(t,key){const[a,m]=await Promise.all([getJSON(`${FHURL}stock/profile2?symbol=${encodeURIComponent(t)}&token=${key}`),getJSON(`${FHURL}stock/metric?symbol=${encodeURIComponent(t)}&metric=all&token=${key}`)]),x=m.metric||{},sh=(a.shareOutstanding||0)*1e6,eps=x.epsTTM??x.epsBasicExclExtraItemsTTM??null;
 if(!a.name&&x["52WeekHigh"]==null)throw new Error("No data");
 return{n:a.name||t,s:a.finnhubIndustry||null,i:a.finnhubIndustry||null,mc:a.marketCapitalization?a.marketCapitalization*1e6:null,pe:x.peTTM??x.peBasicExclExtraTTM??null,dy:x.dividendYieldIndicatedAnnual!=null?x.dividendYieldIndicatedAnnual/100:null,eps,rev:x.revenuePerShareTTM&&sh?x.revenuePerShareTTM*sh:null,ni:eps!=null&&sh?eps*sh:null,pm:x.netProfitMarginTTM!=null?x.netProfitMarginTTM/100:null,de:x["totalDebt/totalEquityAnnual"]??x["totalDebt/totalEquityQuarterly"]??null,hi:x["52WeekHigh"]??null,lo:x["52WeekLow"]??null}}
async function tdQuoteProfile(t,key){const q=await getJSON(`${TDURL}quote?symbol=${encodeURIComponent(t)}&apikey=${key}`);if(q.status==="error"||!q.symbol)throw new Error(q.message||"No data");const w=q.fifty_two_week||{};return{n:q.name||t,s:null,i:q.exchange||null,mc:null,pe:null,dy:null,eps:null,rev:null,ni:null,pm:null,de:null,hi:w.high?+w.high:null,lo:w.low?+w.low:null}}

async function fhNews(t, key) { const f = d => d.toISOString().slice(0, 10), j = await getJSON(`${FHURL}company-news?symbol=${encodeURIComponent(t)}&from=${f(new Date(Date.now() - 7 * 864e5))}&to=${f(new Date())}&token=${key}`); return (Array.isArray(j) ? j : []).slice(0, 6).map(x => ({ h: x.headline, s: x.source, u: x.url, d: (x.datetime || 0) * 1000 })); }
async function fhEarnings(t, key) { const f = d => d.toISOString().slice(0, 10), j = await getJSON(`${FHURL}calendar/earnings?from=${f(new Date())}&to=${f(new Date(Date.now() + 120 * 864e5))}&symbol=${encodeURIComponent(t)}&token=${key}`); return (j.earningsCalendar || []).slice(0, 1).map(x => ({ date: x.date, hour: x.hour, eps: x.epsEstimate })); }

export default {
  async fetch(req, env, ctx) {
    const cors = { "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url), cache = caches.default;
    try {
      const hit = await cache.match(req);
      if (hit) { const r = new Response(hit.body, hit); Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v)); return r; }
    } catch (e) {}
    try {
      const t = (url.searchParams.get("symbol") || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
      let data, ttl;
      if (url.pathname === "/series") {
        if (!t) throw new Error("symbol required");
        const intra = url.searchParams.get("range") === "intraday";
        data = await tdSeries(t, env.TWELVE_KEY, intra); ttl = intra ? 300 : 3600;
      } else if (url.pathname === "/profile") {
        if (!t) throw new Error("symbol required");
        data = env.FINNHUB_KEY ? await fhProfile(t, env.FINNHUB_KEY) : await tdQuoteProfile(t, env.TWELVE_KEY); ttl = 86400;
      } else if (url.pathname === "/search") {
        const q = (url.searchParams.get("q") || "").slice(0, 40);
        data = env.FINNHUB_KEY ? await fhSearch(q, env.FINNHUB_KEY) : await tdSearch(q, env.TWELVE_KEY); ttl = 3600;
      } else if (url.pathname === "/news") {
        if (!t || !env.FINNHUB_KEY) throw new Error("FINNHUB_KEY and symbol required");
        data = await fhNews(t, env.FINNHUB_KEY); ttl = 1800;
      } else if (url.pathname === "/earnings") {
        if (!t || !env.FINNHUB_KEY) throw new Error("FINNHUB_KEY and symbol required");
        data = await fhEarnings(t, env.FINNHUB_KEY); ttl = 21600;
      } else return new Response("Not found", { status: 404, headers: cors });
      const res = new Response(JSON.stringify(data), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=" + ttl } });
      try { ctx.waitUntil(cache.put(req, res.clone())); } catch (e) {}
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }
  },
};
