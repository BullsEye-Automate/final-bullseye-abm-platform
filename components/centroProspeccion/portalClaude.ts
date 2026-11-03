// Adaptador de datos del Centro de prospección.
//
// La lógica original del artifact usa la API de claude.ai (`window.claude`):
// claude.use('db' | 'user' | 'downloads' | 'assets'), con una base de
// documentos al estilo Firestore (collection / doc / onSnapshot / add / set /
// update / delete / where / orderBy / limit). Este módulo implementa esa
// misma API sobre las rutas del portal (/api/centro/*), para que la página
// funcione igual sin tocar su lógica.
//
// Sincronización: al abrir se descargan las colecciones vivas y luego se
// piden los cambios cada POLL_MS (y al volver a la pestaña). Las escrituras
// propias se reflejan al instante en la página.

type Data = Record<string, unknown>;
type Entry = { d: Data; v: number };
type Listener = () => void;

const POLL_MS = 15_000;
const LIVE = new Set(["clientes", "solicitudes", "registro", "plan", "cuentas", "mantenimiento", "docs_cliente", "historial", "vinculos", "config"]);

class CentroError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = res.status === 401 ? "unauthenticated" : res.status === 403 ? "invalid_argument" : res.status === 404 ? "not-found" : "unavailable";
    throw new CentroError((json as { error?: string }).error || `Error ${res.status}`, (json as { code?: string }).code || code);
  }
  return json as T;
}

function newId(): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => a[b % a.length]).join("");
}

function clone<T>(x: T): T {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

// ---------- snapshots (forma Firestore) ----------

class DocSnap {
  constructor(public id: string, private entry: Entry | undefined) {}
  get exists() { return !!this.entry; }
  data() { return this.entry ? clone(this.entry.d) : undefined; }
}

class QuerySnap {
  docs: DocSnap[];
  constructor(rows: [string, Entry][]) { this.docs = rows.map(([id, e]) => new DocSnap(id, e)); }
  get size() { return this.docs.length; }
  get empty() { return this.docs.length === 0; }
  forEach(fn: (d: DocSnap) => void) { this.docs.forEach(fn); }
}

// ---------- almacén local ----------

class Store {
  cols = new Map<string, Map<string, Entry>>();
  listeners = new Set<Listener>();
  since: string | null = null;
  ready: Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing: Promise<void> | null = null;
  private stopped = false;
  private onVisible = () => { if (document.visibilityState === "visible") this.sync().catch(() => {}); };
  onError: ((e: CentroError) => void) | null = null;

  constructor() {
    this.ready = this.sync();
    this.timer = setInterval(() => { this.sync().catch(() => {}); }, POLL_MS);
    document.addEventListener("visibilitychange", this.onVisible);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onVisible);
    this.listeners.clear();
  }

  col(name: string) {
    let m = this.cols.get(name);
    if (!m) { m = new Map(); this.cols.set(name, m); }
    return m;
  }

  notify() { this.listeners.forEach((l) => { try { l(); } catch (e) { console.error(e); } }); }

  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      try {
        const q = this.since ? `?since=${encodeURIComponent(this.since)}` : "";
        const r = await api<{ now: string; full: boolean; docs: { c: string; id: string; d: Data; v: number }[]; deleted: { c: string; id: string }[] }>(`/api/centro/sync${q}`);
        let changed = r.full;
        if (r.full) for (const c of LIVE) this.cols.set(c, new Map());
        for (const x of r.docs) {
          const m = this.col(x.c);
          const cur = m.get(x.id);
          if (!cur || cur.v !== x.v || r.full) { m.set(x.id, { d: x.d, v: x.v }); changed = true; }
        }
        for (const x of r.deleted) {
          const m = this.col(x.c);
          if (m.has(x.id)) { m.delete(x.id); changed = true; }
        }
        this.since = r.now;
        if (changed) this.notify();
      } catch (e) {
        if (this.onError) this.onError(e as CentroError);
        throw e;
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }
}

// ---------- referencias ----------

type Clause = { field: string; op: string; value: unknown };

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function passes(d: Data, w: Clause[]): boolean {
  return w.every(({ field, op, value }) => {
    const v = d[field];
    switch (op) {
      case "==": return JSON.stringify(v) === JSON.stringify(value);
      case "!=": return JSON.stringify(v) !== JSON.stringify(value);
      case "<": return v != null && cmp(v, value) < 0;
      case "<=": return v != null && cmp(v, value) <= 0;
      case ">": return v != null && cmp(v, value) > 0;
      case ">=": return v != null && cmp(v, value) >= 0;
      case "in": return Array.isArray(value) && value.some((x) => JSON.stringify(x) === JSON.stringify(v));
      case "array-contains": return Array.isArray(v) && v.some((x) => JSON.stringify(x) === JSON.stringify(value));
      default: return true;
    }
  });
}

function makeDb(store: Store) {
  async function write(op: "set" | "update" | "delete", c: string, id: string, d?: Data) {
    // Firestore: update sobre un documento inexistente falla.
    const m = store.col(c);
    const prev = m.get(id);
    await api("/api/centro/write", { method: "POST", body: JSON.stringify({ ops: [{ op, c, id, d }] }) });
    // Refleja el cambio al instante; la versión real llega con el siguiente sync.
    if (op === "delete") m.delete(id);
    else if (op === "set") m.set(id, { d: clone(d!), v: (prev?.v ?? 0) + 1 });
    else m.set(id, { d: { ...(prev?.d ?? {}), ...clone(d!) }, v: (prev?.v ?? 0) + 1 });
    store.notify();
    store.sync().catch(() => {});
  }

  function docRef(c: string, id: string) {
    return {
      id,
      async get() {
        if (LIVE.has(c)) {
          await store.ready.catch(() => {});
          return new DocSnap(id, store.col(c).get(id));
        }
        const r = await api<{ exists: boolean; d?: Data; v?: number }>(`/api/centro/doc?c=${encodeURIComponent(c)}&id=${encodeURIComponent(id)}`);
        return new DocSnap(id, r.exists ? { d: r.d!, v: r.v! } : undefined);
      },
      set(d: Data) { return write("set", c, id, d); },
      update(d: Data) { return write("update", c, id, d); },
      delete() { return write("delete", c, id); },
      onSnapshot(cb: (s: DocSnap) => void, onErr?: (e: unknown) => void) {
        const fire = () => cb(new DocSnap(id, store.col(c).get(id)));
        store.listeners.add(fire);
        store.ready.then(fire, (e) => onErr && onErr(e));
        return () => { store.listeners.delete(fire); };
      },
    };
  }

  function query(c: string, where: Clause[] = [], order: { field: string; dir: string } | null = null, lim: number | null = null) {
    const rows = (): [string, Entry][] => {
      let r = [...store.col(c).entries()].filter(([, e]) => passes(e.d, where));
      if (order) {
        const s = order.dir === "desc" ? -1 : 1;
        r.sort((a, b) => s * cmp(a[1].d[order.field], b[1].d[order.field]));
      } else {
        r.sort((a, b) => a[0].localeCompare(b[0]));
      }
      if (lim != null) r = r.slice(0, lim);
      return r;
    };
    return {
      where(field: string, op: string, value: unknown) { return query(c, [...where, { field, op, value }], order, lim); },
      orderBy(field: string, dir = "asc") { return query(c, where, { field, dir }, lim); },
      limit(n: number) { return query(c, where, order, n); },
      async get() {
        await store.ready.catch(() => {});
        if (LIVE.has(c)) await store.sync().catch(() => {});
        return new QuerySnap(rows());
      },
      onSnapshot(cb: (s: QuerySnap) => void, onErr?: (e: unknown) => void) {
        const fire = () => cb(new QuerySnap(rows()));
        store.listeners.add(fire);
        store.ready.then(fire, (e) => onErr && onErr(e));
        return () => { store.listeners.delete(fire); };
      },
    };
  }

  return {
    collection(c: string) {
      const q = query(c);
      return {
        ...q,
        doc(id?: string) { return docRef(c, id || newId()); },
        async add(d: Data) {
          const id = newId();
          await write("set", c, id, d);
          return docRef(c, id);
        },
      };
    },
    doc(path: string) {
      const [c, id] = path.split("/");
      return docRef(c, id);
    },
  };
}

// ---------- usuario, descargas y archivos ----------

function makeUser() {
  let me: Promise<{ id: string; email: string; name: string | null; isOwner: boolean; canWrite: boolean }> | null = null;
  return {
    me() { me = me ?? api("/api/centro/me"); return me; },
    async can(_perm: string) { const m = await this.me(); return m.canWrite; },
    async profiles(ids: string[]) {
      const r = await api<{ profiles: Record<string, { name: string; color: string }> }>("/api/centro/profiles", { method: "POST", body: JSON.stringify({ ids }) });
      return r.profiles;
    },
  };
}

const downloads = {
  async save({ filename, data }: { filename: string; data: Blob | string | ArrayBuffer }) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith(".csv") ? "text/csv;charset=utf-8" : "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },
};

const assets = {
  async upload(file: File, opts?: { type?: string }) {
    const contentType = opts?.type || file.type || "application/octet-stream";
    let prep: { id: string; uploadUrl: string; contentType: string; sizeBytes: number };
    try {
      prep = await api("/api/centro/assets", { method: "POST", body: JSON.stringify({ fileName: file.name, contentType, size: file.size }) });
    } catch (e) {
      throw new CentroError((e as Error).message, /25 MB/.test((e as Error).message) ? "too_large" : "upload_failed");
    }
    const put = await fetch(prep.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": contentType, "x-upsert": "true" } });
    if (!put.ok) throw new CentroError("No se pudo subir el archivo", "upload_failed");
    return { id: prep.id, contentType: prep.contentType, sizeBytes: prep.sizeBytes };
  },
  async delete(id: string) {
    await api(`/api/centro/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

// Equivalente a window.claude para la lógica del artifact.
export function createPortalClaude(onError?: (e: Error) => void) {
  const store = new Store();
  if (onError) store.onError = onError;
  const db = makeDb(store);
  const user = makeUser();
  return {
    async use(name: string) {
      if (name === "db") { await store.ready; return db; }
      if (name === "user") return user;
      if (name === "downloads") return downloads;
      if (name === "assets") return assets;
      throw new CentroError(`Capacidad no disponible: ${name}`, "unavailable");
    },
    __stop() { store.stop(); },
  };
}
