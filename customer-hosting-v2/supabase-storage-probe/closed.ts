// Deployed after the one-shot isolated trial. No credentials, SDK or resource access.
Deno.serve(()=>Response.json({error:'Isolated verification endpoint is closed'},{status:403}));
