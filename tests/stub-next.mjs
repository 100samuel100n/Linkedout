export class NextResponse { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers || {}; } static json(d, init = {}) { return new NextResponse(JSON.stringify(d), init); } static next() { return new NextResponse(null); } }
export const after = (f) => f; export const cookies = async () => ({ get: () => null });
