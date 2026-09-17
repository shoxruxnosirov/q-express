globalThis.fetch = async (url) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  throw new Error("Unexpected outbound request in integration test");
};