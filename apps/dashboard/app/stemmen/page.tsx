import type { Metadata } from "next";
import Link from "next/link";
import { speechProvider, voicesFor } from "@animus/brain/voice";
import { dynimos } from "@animus/db/schema";
import { db } from "../../lib/db";
import { getCatalog, getTier } from "../../lib/voice-catalog";
import { ActionForm } from "../action-form";
import { setVoice } from "../actions";
import { VoiceCatalog } from "../voice-catalog";
import { VoiceDesign } from "../voice-design";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stemmen" };

// Stemmen (#131): één catalogus + ontwerp/kloon-flow voor alle Dynimo's samen, met per Dynimo de huidige stem.
export default async function StemmenPage() {
  const rows = await db
    .select({ id: dynimos.id, name: dynimos.name, voice: dynimos.voice, voiceDescription: dynimos.voiceDescription })
    .from(dynimos)
    .orderBy(dynimos.id);

  const provider = speechProvider(process.env);
  const voices = voicesFor(provider);
  const catalog =
    provider === "elevenlabs"
      ? await getCatalog().then(
          (list) => ({ list }),
          (error: unknown) => ({ error: error instanceof Error ? error.message : "onbekende fout" }),
        )
      : null;
  const freeTier = provider === "elevenlabs" && (await getTier()) === "free";
  const catalogList = catalog && "list" in catalog ? catalog.list : null;

  const voiceName = (voice: string | null) => (voice ? (catalogList?.find((v) => v.id === voice)?.name ?? voice) : "standaard");

  return (
    <>
      <header className="page-head">
        <h1>Stemmen</h1>
      </header>
      <p className="page-note">
        Kies per Dynimo een stem uit de catalogus, of ontwerp of kloon een eigen stem. Ontwerpen en klonen kosten ElevenLabs-tegoed.
      </p>

      <section className="section">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Dynimo</th>
                <th>Huidige stem</th>
                <th>Beschrijving</th>
                {provider !== "elevenlabs" && <th>Kiezen</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((dynimo) => (
                <tr key={dynimo.id}>
                  <td>
                    <Link href={`/dynimo/${dynimo.id}`}>{dynimo.name}</Link>
                  </td>
                  <td>{voiceName(dynimo.voice)}</td>
                  <td>{dynimo.voiceDescription ?? "geen"}</td>
                  {provider !== "elevenlabs" && (
                    <td>
                      <ActionForm action={setVoice} label="Zetten" pendingLabel="Zet…" id={dynimo.id}>
                        <select name="voice" aria-label={`Stem voor ${dynimo.name}`} defaultValue={dynimo.voice ?? ""}>
                          <option value="">standaard</option>
                          {voices.map((voice) => (
                            <option key={voice} value={voice}>
                              {voice}
                            </option>
                          ))}
                        </select>
                      </ActionForm>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="muted">Nog geen Dynimo&apos;s.</p>}
      </section>

      {provider === "elevenlabs" ? (
        rows.length > 0 && (
          <>
            <section className="section">
              <div className="section-head">
                <h2>Catalogus</h2>
              </div>
              {catalogList ? (
                <VoiceCatalog voices={catalogList} dynimos={rows} />
              ) : (
                catalog &&
                "error" in catalog && (
                  <p role="alert" className="error">
                    Stemcatalogus niet beschikbaar ({catalog.error}); kies voorlopig de vaste lijst op de pagina van een Dynimo.
                  </p>
                )
              )}
            </section>
            <section className="section">
              <div className="section-head">
                <h2>Eigen stem</h2>
              </div>
              <VoiceDesign dynimos={rows} blocked={freeTier} />
            </section>
          </>
        )
      ) : (
        <p className="page-note">Catalogus, ontwerpen en klonen vragen ElevenLabs. Kies hierboven per Dynimo uit de vaste lijst.</p>
      )}
    </>
  );
}
