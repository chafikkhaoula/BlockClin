const fabricGatewayUrl = process.env.FABRIC_GATEWAY_URL || 'http://127.0.0.1:8081';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await fetch(`${fabricGatewayUrl}/provenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json({ error: 'Fabric Gateway is unavailable. Start the local gateway and Fabric network first.' }, { status: 503 });
  }
}
