import { Elysia, t } from "elysia";
import {
	ApiError,
	createCuti,
	deleteCuti,
	getCuti,
	listCuti,
	type CutiInput,
	type CutiStatus,
	updateCuti
} from "./google-sheets";

const statusSchema = t.Union([
	t.Literal("Menunggu"),
	t.Literal("Disetujui"),
	t.Literal("Ditolak")
]);

const cutiSchema = t.Object({
	nama: t.String({ minLength: 1 }),
	nik: t.String({ minLength: 1 }),
	tanggalMulai: t.String({ minLength: 1 }),
	tanggalSelesai: t.String({ minLength: 1 }),
	alasan: t.String({ minLength: 1 }),
	status: t.Optional(statusSchema)
});

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error("PORT harus berupa angka antara 1 dan 65535.");
}

const app = new Elysia()
	.onError(({ code, error, set }) => {
		if (error instanceof ApiError) {
			set.status = error.status;
			return { message: error.message };
		}

		if (code === "VALIDATION") {
			set.status = 400;
			return { message: "Body request tidak valid. Periksa kembali field yang dikirim." };
		}

		if (code === "NOT_FOUND") {
			set.status = 404;
			return { message: "Endpoint tidak ditemukan." };
		}

		console.error(error);
		set.status = 500;
		return { message: "Terjadi kesalahan pada server." };
	})
	.get("/", () => ({ message: "Cuti Digital API", health: "/health" }))
	.get("/health", () => ({ status: "ok" }))
	.get("/api/cuti", async () => ({ data: await listCuti() }))
	.get("/api/cuti/:id", async ({ params }) => ({ data: await getCuti(params.id) }))
	.post(
		"/api/cuti",
		async ({ body, set }) => {
			set.status = 201;
			return { data: await createCuti(body as CutiInput) };
		},
		{ body: cutiSchema }
	)
	.put(
		"/api/cuti/:id",
		async ({ params, body }) => ({
			data: await updateCuti(params.id, body as CutiInput)
		}),
		{ body: cutiSchema }
	)
	.delete("/api/cuti/:id", async ({ params }) => {
		await deleteCuti(params.id);
		return { message: "Pengajuan cuti berhasil dihapus." };
	})
	.listen(port);

console.log(`Elysia berjalan di http://${app.server?.hostname}:${app.server?.port}`);

export type { CutiInput, CutiStatus };

export default app;