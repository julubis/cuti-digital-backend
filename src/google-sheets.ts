const SHEETS_API = "https://sheets.googleapis.com/v4";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export const CUTI_HEADERS = [
	"id",
	"nama",
	"nik",
	"tanggalMulai",
	"tanggalSelesai",
	"alasan",
	"status",
	"createdAt",
	"updatedAt"
];

export class ApiError extends Error {
	constructor(
		public readonly status: 400 | 404 | 503,
		message: string
	) {
		super(message);
		this.name = "ApiError";
	}
}

export type CutiStatus = "Menunggu" | "Disetujui" | "Ditolak";

export type CutiRecord = {
	id: string;
	nama: string;
	nik: string;
	tanggalMulai: string;
	tanggalSelesai: string;
	alasan: string;
	status: CutiStatus;
	createdAt: string;
	updatedAt: string;
};

export type CutiInput = Pick<
	CutiRecord,
	"nama" | "nik" | "tanggalMulai" | "tanggalSelesai" | "alasan"
> & { status?: CutiStatus };

type LocatedCuti = { record: CutiRecord; rowNumber: number };

let cachedAccessToken: { value: string; expiresAt: number } | undefined;
let cachedSheetId: number | undefined;
let initialization: Promise<void> | undefined;

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new ApiError(
			503,
			`Konfigurasi ${name} belum diisi. Ikuti petunjuk konfigurasi di README.`
		);
	}
	return value;
}

function spreadsheetId(): string {
	return requiredEnv("GOOGLE_SHEET_ID");
}

function sheetTitle(): string {
	return process.env.GOOGLE_SHEET_TAB?.trim() || "Cuti";
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown): string {
	return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodePrivateKey(pem: string): Uint8Array {
	const base64 = pem
		.replace(/\\n/g, "\n")
		.replace(/-----BEGIN PRIVATE KEY-----/g, "")
		.replace(/-----END PRIVATE KEY-----/g, "")
		.replace(/\s/g, "");
	const binary = atob(base64);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

async function getAccessToken(): Promise<string> {
	if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
		return cachedAccessToken.value;
	}

	const email = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
	const privateKey = requiredEnv("GOOGLE_PRIVATE_KEY");
	const now = Math.floor(Date.now() / 1000);
	const unsignedToken = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson({
		iss: email,
		scope: REQUIRED_SCOPE,
		aud: TOKEN_URL,
		iat: now,
		exp: now + 3600
	})}`;
	const key = await crypto.subtle.importKey(
		"pkcs8",
		toArrayBuffer(decodePrivateKey(privateKey)),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(unsignedToken)
	);
	const assertion = `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion
		})
	});

	if (!response.ok) {
		throw new Error(`Gagal mendapatkan token Google (${response.status}).`);
	}

	const token = (await response.json()) as {
		access_token: string;
		expires_in: number;
	};
	cachedAccessToken = {
		value: token.access_token,
		expiresAt: Date.now() + token.expires_in * 1000 - 60_000
	};
	return token.access_token;
}

async function googleFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
	const accessToken = await getAccessToken();
	const response = await fetch(url, {
		...init,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...init.headers
		}
	});

	if (!response.ok) {
		const details = await response.text();
		throw new Error(`Google Sheets API error (${response.status}): ${details}`);
	}

	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

function spreadsheetUrl(path = ""): string {
	return `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId())}${path}`;
}

function valuesUrl(range: string, suffix = ""): string {
	const encodedRange = encodeURIComponent(range);
	return spreadsheetUrl(`/values/${encodedRange}${suffix}`);
}

function rangeFor(a1Range: string): string {
	return `'${sheetTitle().replace(/'/g, "''")}'!${a1Range}`;
}

async function readValues(range: string): Promise<string[][]> {
	const result = await googleFetch<{ values?: unknown[][] }>(valuesUrl(range));
	return (result.values ?? []).map((row) =>
		row.map((value) => (value == null ? "" : String(value)))
	);
}

async function writeValues(range: string, values: string[][]): Promise<void> {
	await googleFetch(valuesUrl(range, "?valueInputOption=RAW"), {
		method: "PUT",
		body: JSON.stringify({ range, majorDimension: "ROWS", values })
	});
}

async function ensureSheet(): Promise<number> {
	if (cachedSheetId !== undefined) return cachedSheetId;

	const metadata = await googleFetch<{
		sheets?: { properties?: { sheetId?: number; title?: string } }[];
	}>(spreadsheetUrl("?fields=sheets.properties(sheetId,title)"));
	const existing = metadata.sheets?.find(
		(sheet) => sheet.properties?.title === sheetTitle()
	);
	if (existing?.properties?.sheetId !== undefined) {
		cachedSheetId = existing.properties.sheetId;
		return cachedSheetId;
	}

	const created = await googleFetch<{
		replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
	}>(spreadsheetUrl(":batchUpdate"), {
		method: "POST",
		body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetTitle() } } }] })
	});
	const newSheetId = created.replies?.[0]?.addSheet?.properties?.sheetId;
	if (newSheetId === undefined) throw new Error("Google Sheets tidak mengembalikan sheetId.");
	cachedSheetId = newSheetId;
	return newSheetId;
}

async function ensureInitialized(): Promise<void> {
	if (!initialization) {
		initialization = (async () => {
			await ensureSheet();
			const headerRange = rangeFor("A1:I1");
			const values = await readValues(headerRange);
			const currentHeaders = values[0] ?? [];
			if (currentHeaders.length === 0 || currentHeaders.every((value) => !value)) {
				await writeValues(headerRange, [CUTI_HEADERS]);
				return;
			}
			if (CUTI_HEADERS.some((header, index) => currentHeaders[index] !== header)) {
				throw new Error(
					`Header tab "${sheetTitle()}" tidak sesuai. Kolom yang diperlukan: ${CUTI_HEADERS.join(", ")}.`
				);
			}
		})();
	}

	try {
		await initialization;
	} catch (error) {
		initialization = undefined;
		throw error;
	}
}

function rowToRecord(row: string[]): CutiRecord | undefined {
	const [id, nama, nik, tanggalMulai, tanggalSelesai, alasan, status, createdAt, updatedAt] = row;
	if (!id || !nama || !nik) return undefined;
	return {
		id,
		nama,
		nik,
		tanggalMulai: tanggalMulai ?? "",
		tanggalSelesai: tanggalSelesai ?? "",
		alasan: alasan ?? "",
		status: status === "Disetujui" || status === "Ditolak" ? status : "Menunggu",
		createdAt: createdAt ?? "",
		updatedAt: updatedAt ?? ""
	};
}

async function locateRecords(): Promise<LocatedCuti[]> {
	await ensureInitialized();
	const rows = await readValues(rangeFor("A:I"));
	return rows.slice(1).flatMap((row, index) => {
		const record = rowToRecord(row);
		return record ? [{ record, rowNumber: index + 2 }] : [];
	});
}

function recordToRow(record: CutiRecord): string[] {
	return [
		record.id,
		record.nama,
		record.nik,
		record.tanggalMulai,
		record.tanggalSelesai,
		record.alasan,
		record.status,
		record.createdAt,
		record.updatedAt
	];
}

function cleanInput(input: CutiInput): Omit<CutiRecord, "id" | "createdAt" | "updatedAt"> {
	const clean = (field: string, value: string) => {
		const result = value.trim();
		if (!result) throw new ApiError(400, `Field ${field} wajib diisi.`);
		return result;
	};

	return {
		nama: clean("nama", input.nama),
		nik: clean("nik", input.nik),
		tanggalMulai: clean("tanggalMulai", input.tanggalMulai),
		tanggalSelesai: clean("tanggalSelesai", input.tanggalSelesai),
		alasan: clean("alasan", input.alasan),
		status: input.status ?? "Menunggu"
	};
}

export async function listCuti(): Promise<CutiRecord[]> {
	const rows = await locateRecords();
	return rows.map(({ record }) => record);
}

export async function getCuti(id: string): Promise<CutiRecord> {
	const found = (await locateRecords()).find(({ record }) => record.id === id);
	if (!found) throw new ApiError(404, "Pengajuan cuti tidak ditemukan.");
	return found.record;
}

export async function createCuti(input: CutiInput): Promise<CutiRecord> {
	await ensureInitialized();
	const now = new Date().toISOString();
	const record: CutiRecord = {
		id: crypto.randomUUID(),
		...cleanInput(input),
		createdAt: now,
		updatedAt: now
	};
	await googleFetch(valuesUrl(rangeFor("A:I"), ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"), {
		method: "POST",
		body: JSON.stringify({ values: [recordToRow(record)], majorDimension: "ROWS" })
	});
	return record;
}

export async function updateCuti(id: string, input: CutiInput): Promise<CutiRecord> {
	const found = (await locateRecords()).find(({ record }) => record.id === id);
	if (!found) throw new ApiError(404, "Pengajuan cuti tidak ditemukan.");
	const record: CutiRecord = {
		...found.record,
		...cleanInput(input),
		updatedAt: new Date().toISOString()
	};
	await writeValues(rangeFor(`A${found.rowNumber}:I${found.rowNumber}`), [recordToRow(record)]);
	return record;
}

export async function deleteCuti(id: string): Promise<void> {
	const found = (await locateRecords()).find(({ record }) => record.id === id);
	if (!found) throw new ApiError(404, "Pengajuan cuti tidak ditemukan.");
	const sheetId = await ensureSheet();
	await googleFetch(spreadsheetUrl(":batchUpdate"), {
		method: "POST",
		body: JSON.stringify({
			requests: [
				{
					deleteDimension: {
						range: {
							sheetId,
							dimension: "ROWS",
							startIndex: found.rowNumber - 1,
							endIndex: found.rowNumber
						}
					}
				}
			]
		})
	});
}
