function countResources(bundle: { entry?: unknown }) {
  return Array.isArray(bundle.entry) ? bundle.entry.length : 0;
}

export async function POST(request: Request) {
  try {
    const bundle = await request.json() as { resourceType?: string; type?: string; entry?: unknown };
    const resourceCount = countResources(bundle);

    if (bundle.resourceType !== 'Bundle' || bundle.type !== 'collection' || resourceCount === 0) {
      return Response.json({ error: 'The receiving endpoint accepts a non-empty FHIR collection Bundle only.' }, { status: 400 });
    }

    return Response.json({
      receipt: `BC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      receivedAt: new Date().toISOString(),
      resourceCount,
    }, { status: 201 });
  } catch {
    return Response.json({ error: 'The receiving endpoint could not read the submitted FHIR Bundle.' }, { status: 400 });
  }
}
