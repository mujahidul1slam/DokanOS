async function check() {
  const res = await fetch("https://dokanos-732dtm5x4-mujahidul1slams-projects.vercel.app");
  const html = await res.text();
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  console.log("Status:", res.status);
  console.log("Title:", titleMatch ? titleMatch[1] : "(no title tag)");
  console.log("Body snippet:", html.slice(html.indexOf("<body"), html.indexOf("<body") + 500));
}
check();
