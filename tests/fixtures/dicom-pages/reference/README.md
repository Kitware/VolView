# DICOM corpus reference

Expected values for the DICOM corpus manifests, derived without VolView:

- `tests/dicomVolumeCorpus.json`: single files, run by every e2e run.
- `tests/dicomExtendedCorpus.json`: the slow tier, run with `DICOM_CORPUS=extended`.
- `tests/dicomCompositionCorpus.json`: multi-file series composition.

Each entry records `facts` about the file (tags, which geometry tags exist,
frame axis, reference geometry and pixels) and a `module` block with what the
DICOM loading module is expected to produce (`volume` or the exact `error`,
fallback geometry, the spacing it picks where the file states none, storage
precision). How the app presents a file belongs in
app specs, not here.

Files stay at their public source; Git holds the URL, checksum, license and
attribution. Generated files come from `generatedCorpus.ts`.

## Adding a file

```bash
cd tests/fixtures/dicom-pages/reference
uv run python -I corpus_reference.py propose <url> --name dicom-corpus-<id>.dcm --id <id>
```

Fill in `license`, `attribution`, `sourcePage` and `quirk`. Check the license
of the exact file: IDC series can be CC BY-NC within the same bucket as CC BY
ones. When `reference` is `manual`, highdicom could not build the volume, so
write the geometry from the standard, its `derivation`, and the
`derivationTags` it rests on, which `verify` checks against the file. Paste the
entry into the extended manifest; move it to the fast tier once it passes and
is small.

For a generated file, add a builder to `generatedCorpus.ts`, then:

```bash
npx tsx tests/fixtures/dicom-pages/writeGeneratedCorpus.ts
uv run python -I corpus_reference.py propose --generated dicom-corpus-generated-<key>.dcm
```

## Checking the manifests

```bash
node tests/downloadDatasets.ts --extended
npx tsx tests/fixtures/dicom-pages/writeGeneratedCorpus.ts
cd tests/fixtures/dicom-pages/reference && uv run python -I corpus_reference.py verify
```

`verify` is not part of CI. Run it when entries or the pinned reference
versions change.

## Running the slow tier

```bash
DICOM_CORPUS=extended npm run test:e2e:chrome -- --spec tests/specs/dicom-volume-corpus.e2e.ts
```

An unreachable source is reported and its test skipped; a changed file fails.
