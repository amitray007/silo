/**
 * The read-aloud model files silo serves (`GET /api/tts/files/:engine/*`). Every file is pinned to
 * a Hugging Face commit and carries its size and sha256, so the server downloads each one once,
 * checks it, and serves nothing that is not listed here.
 *
 * Licenses (all redistributable):
 * - Phonon 31m English (`gradium/phonon-31m-en`): weights Apache-2.0; `phonon-tts` code MIT or Apache-2.0.
 * - Phonon voices (`gradium/phonon-voices`): Apache-2.0 (the catalog card). Only the 25 English
 *   voices (en-us and en-gb) ship. The 12 character voices and the fr, de, es and pt voices do not.
 * - Kokoro 82M (`onnx-community/Kokoro-82M-v1.0-ONNX`): Apache-2.0; `kokoro-js` Apache-2.0. Only
 *   the 28 voices `kokoro-js@1.2.1` lists (en-us and en-gb) ship.
 * - Phonon 40m (CC BY-NC 4.0) is not here and must not be added.
 *
 * To refresh the pins (all commands read public repos):
 *   curl -sS "https://huggingface.co/api/models/gradium/phonon-31m-en/revision/main"    # commit sha
 *   curl -sS "https://huggingface.co/api/models/gradium/phonon-voices/revision/main"    # commit sha
 *   curl -sS "https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.0-ONNX/revision/main"
 *   curl -sSL "https://huggingface.co/gradium/phonon-voices/resolve/<commit>/voices.jsonl"  # voice names
 *   curl -sSL "https://huggingface.co/<repo>/resolve/<commit>/<file>" | tee file | wc -c    # size
 *   shasum -a 256 file                                                                      # sha256
 * The sizes and hashes below were computed by downloading every file once with a script that
 * streams each URL through `crypto.createHash('sha256')` and counts the bytes; small files that
 * Hugging Face does not store in LFS (config.json, tokenizer.json) were hashed the same way.
 */

export type TtsVoiceInfo = { name: string; locale: 'en-us' | 'en-gb'; gender: 'female' | 'male' };

export type TtsFileEntry = {
  /** The pinned upstream address. */
  url: string;
  size: number;
  sha256: string;
  /** Phonon catalog voices carry their display details; Kokoro reports its own after loading. */
  voice?: TtsVoiceInfo;
};

export type TtsEngineManifest = {
  label: string;
  license: string;
  /** Request path (under `/api/tts/files/<engine>/`) to its entry. */
  files: Readonly<Record<string, TtsFileEntry>>;
};

export type TtsManifest = Readonly<Record<string, TtsEngineManifest>>;

type Pin = (file: string, size: number, sha256: string, voice?: TtsVoiceInfo) => TtsFileEntry;

/** Entries of one repo at one commit. */
function pinned(repo: string, commit: string): Pin {
  return (file, size, sha256, voice) => ({
    url: `https://huggingface.co/${repo}/resolve/${commit}/${file}`,
    size,
    sha256,
    ...(voice ? { voice } : {}),
  });
}

const phonon = pinned('gradium/phonon-31m-en', '8c64b55ec301728e2d1695bfea87a08a267d0c2d');
const phononVoices = pinned('gradium/phonon-voices', '0ee17205f254b5abc43b266c8a0f215565c352f7');
const kokoro = pinned(
  'onnx-community/Kokoro-82M-v1.0-ONNX',
  '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
);

export const TTS_MANIFEST = {
  phonon: {
    label: 'Phonon 31M',
    license: 'Apache-2.0',
    files: {
      'config.json': phonon(
        'config.json',
        2851,
        '7062ea376e6b158543c8abec8e5af67df171c49ad70eb7e2a0fb25c16f265e06',
      ),
      'tokenizer.json': phonon(
        'tokenizer.json',
        277967,
        '691a00068fa7b989f2f3e5ae5daa2d1a5bb319f2d5360deafcfb19a8bb6e7936',
      ),
      'model.q8.gguf': phonon(
        'model.q8.gguf',
        64512352,
        'a7d9aad2cd6dc66473f24a08bc6d2939030ef4d751ef82349361fbef3272dbae',
      ),
      'default-voice.safetensors': phonon(
        'default-voice.safetensors',
        256136,
        'f739e8c4c76ee7f92e7c94a82002748c8cd22e99582ac49f7b9b94cd63786e18',
      ),
      'voices/NbpkqMVS3CJeq2j8.safetensors': phononVoices(
        'voices/NbpkqMVS3CJeq2j8.safetensors',
        256136,
        '97c7f8c253413574406ab80dd23f49c3ebb2517163b00a9bf86b9c4cf43e7e23',
        { name: 'Zoey', locale: 'en-us', gender: 'female' },
      ),
      'voices/NIWIOv5vTi5eRMj8.safetensors': phononVoices(
        'voices/NIWIOv5vTi5eRMj8.safetensors',
        256136,
        '444378eb06b7c492b86e8fc7d13e4db1a3c0cf3e68891a960bf6f0a41a13ef35',
        { name: 'Juniper', locale: 'en-us', gender: 'female' },
      ),
      'voices/vjFyp2BcCyTlUmYb.safetensors': phononVoices(
        'voices/vjFyp2BcCyTlUmYb.safetensors',
        256136,
        '958ea94da14f46dd48c7f64adac11ed2ad2aa45f7ccd165dfebab5272664402e',
        { name: 'Everly', locale: 'en-us', gender: 'female' },
      ),
      'voices/4SZHfMpw-p46Ywgs.safetensors': phononVoices(
        'voices/4SZHfMpw-p46Ywgs.safetensors',
        256136,
        '6b3da6e2d796a20c51af892c482bd6509fb88267a221aff83c870843dee2a123',
        { name: 'Harper', locale: 'en-us', gender: 'female' },
      ),
      'voices/bXwrkHhURL1VFJdG.safetensors': phononVoices(
        'voices/bXwrkHhURL1VFJdG.safetensors',
        256136,
        'a879938aa9a2df0a8220bdadef88137929f71e887bd91e7db205bd5fa11661d2',
        { name: 'Hadley', locale: 'en-us', gender: 'female' },
      ),
      'voices/nGzMHMPAWGaJFHOo.safetensors': phononVoices(
        'voices/nGzMHMPAWGaJFHOo.safetensors',
        256136,
        'a0c3dcb91b2247eca56536be9ae8e8becc1c807b1136c5fe101552d6a155b24a',
        { name: 'Delia', locale: 'en-us', gender: 'female' },
      ),
      'voices/LMDIYE0Oa377Qh6Z.safetensors': phononVoices(
        'voices/LMDIYE0Oa377Qh6Z.safetensors',
        256136,
        '45c582673cb20edb04ddcca2b5a8865ddfb0a82599efadb269021e87d20fbdd4',
        { name: 'Easton', locale: 'en-us', gender: 'male' },
      ),
      'voices/40QrMVgAxFiUnP9f.safetensors': phononVoices(
        'voices/40QrMVgAxFiUnP9f.safetensors',
        256136,
        '0de1098d1051686a138d068e83ff09deb5053328bc74ec9541a1fdb90bfc24da',
        { name: 'Micah', locale: 'en-us', gender: 'male' },
      ),
      'voices/0zLApsZfVLLNaEGl.safetensors': phononVoices(
        'voices/0zLApsZfVLLNaEGl.safetensors',
        256136,
        'dc1341c8937af5534e6bbcc5c0fc5e7c10312229b59061228074f93683fe2261',
        { name: 'Trevor', locale: 'en-us', gender: 'male' },
      ),
      'voices/_6Aslh2DxfmnRLmP.safetensors': phononVoices(
        'voices/_6Aslh2DxfmnRLmP.safetensors',
        256136,
        'beae9e4030efce0a935fcb0f807dc0784d598bcaa87ad4aacb047436b1eaa411',
        { name: 'Russell', locale: 'en-us', gender: 'male' },
      ),
      'voices/qIxlZ7Ei8KvWlyQH.safetensors': phononVoices(
        'voices/qIxlZ7Ei8KvWlyQH.safetensors',
        256136,
        '6e04b84d3ae8751b22bca0a4f63936f9cb648f4f2182b2d0788071ea1c0b68a1',
        { name: 'Preston', locale: 'en-us', gender: 'male' },
      ),
      'voices/d9XCyhjo4JhkHF1d.safetensors': phononVoices(
        'voices/d9XCyhjo4JhkHF1d.safetensors',
        256136,
        'eab20e4f159b48cfbc01b1885804e24f681f80e7a64f909182763a4e3361bee8',
        { name: 'Miles', locale: 'en-us', gender: 'male' },
      ),
      'voices/6PWnV0Nq4wu7RVBT.safetensors': phononVoices(
        'voices/6PWnV0Nq4wu7RVBT.safetensors',
        256136,
        '56494ee67d533ad227ff0dfd0b1c13ff5aa91f1ad6e596e66c2986ba3005e844',
        { name: 'Maeve', locale: 'en-gb', gender: 'female' },
      ),
      'voices/GgfEkEJtxZR7gnpy.safetensors': phononVoices(
        'voices/GgfEkEJtxZR7gnpy.safetensors',
        256136,
        'eb3cd47418349e618408c16bea7153988b3ad04b41a6033039dd474a9a4dcd23',
        { name: 'Freya', locale: 'en-gb', gender: 'female' },
      ),
      'voices/uem82D50GRv2Dwma.safetensors': phononVoices(
        'voices/uem82D50GRv2Dwma.safetensors',
        256136,
        'd41a8f01d6e33450f1ce062d332914da10beee99e585dab531750706f187c48a',
        { name: 'Pippa', locale: 'en-gb', gender: 'female' },
      ),
      'voices/y9bQqIDnyxwqK01t.safetensors': phononVoices(
        'voices/y9bQqIDnyxwqK01t.safetensors',
        256136,
        '21eade9d83b2e66b9364e1b6cd999a3a6704c000a71f27f34e05ace5cdfd58bb',
        { name: 'Elodie-Rose', locale: 'en-gb', gender: 'female' },
      ),
      'voices/gDT1nz7Ie36ZhL-C.safetensors': phononVoices(
        'voices/gDT1nz7Ie36ZhL-C.safetensors',
        256136,
        '1980ab3c35fa98a25b5f3b5e643fd852e14ca8a12a4a26b06aaf1abf2a8c68b1',
        { name: 'Imogen', locale: 'en-gb', gender: 'female' },
      ),
      'voices/m9MxpY6IUGXtWp76.safetensors': phononVoices(
        'voices/m9MxpY6IUGXtWp76.safetensors',
        256136,
        'a906ebf17e43fded12b3d6bd077abb2df33bc86eff51c1beeb82e5d416527db3',
        { name: 'Lottie', locale: 'en-gb', gender: 'female' },
      ),
      'voices/X6NceqF285Gr04gb.safetensors': phononVoices(
        'voices/X6NceqF285Gr04gb.safetensors',
        256136,
        '4de75497fff3030168e8aa6dca23ffeb332b1bc8c25d0bf3507ceadac953ae9c',
        { name: 'Alfie', locale: 'en-gb', gender: 'male' },
      ),
      'voices/YyKcxPG7iIgS3jsK.safetensors': phononVoices(
        'voices/YyKcxPG7iIgS3jsK.safetensors',
        256136,
        '3169d74b47a54d1eb15e4c243f56393abe9fe90c7e1c308ecf96ee67618b152a',
        { name: 'Hugh', locale: 'en-gb', gender: 'male' },
      ),
      'voices/zUCxzrOrugTSis03.safetensors': phononVoices(
        'voices/zUCxzrOrugTSis03.safetensors',
        256136,
        'ff1d0735b8b45710462b1d1f846da040f970c6eb62c7c2f36dbfb8e5bde74f1e',
        { name: 'Edwin', locale: 'en-gb', gender: 'male' },
      ),
      'voices/JOW0vchyswkQUMDS.safetensors': phononVoices(
        'voices/JOW0vchyswkQUMDS.safetensors',
        256136,
        'cc9ac1107b0ffce282374a19beb7bfa95847724e6b7afbac991b4ae4277d5e6d',
        { name: 'Spencer', locale: 'en-gb', gender: 'male' },
      ),
      'voices/dME3IWyZBvmh1n1q.safetensors': phononVoices(
        'voices/dME3IWyZBvmh1n1q.safetensors',
        256136,
        '09ab315c7f4b72b4d71e66cb756184cedfb1f14d222d096e115bf95bfe7b29dc',
        { name: 'Toby', locale: 'en-gb', gender: 'male' },
      ),
      'voices/Zn7g6NxLqXlJb7Qi.safetensors': phononVoices(
        'voices/Zn7g6NxLqXlJb7Qi.safetensors',
        256136,
        'baea0ea9506f3237a5ebfc61afb7c72dbd189c5603b199ef42fbb00dbda379e0',
        { name: 'Teddy', locale: 'en-gb', gender: 'male' },
      ),
      'voices/gfP44RlHwr2kEwk7.safetensors': phononVoices(
        'voices/gfP44RlHwr2kEwk7.safetensors',
        256136,
        'bcc207a73b7885e45b49ab633d3377a10158292e3a7cef9cd6764ad107f1cb9b',
        { name: 'Bryony', locale: 'en-gb', gender: 'female' },
      ),
    },
  },
  kokoro: {
    label: 'Kokoro 82M',
    license: 'Apache-2.0',
    files: {
      'config.json': kokoro(
        'config.json',
        44,
        'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
      ),
      'tokenizer.json': kokoro(
        'tokenizer.json',
        3497,
        '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34',
      ),
      'tokenizer_config.json': kokoro(
        'tokenizer_config.json',
        113,
        'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20',
      ),
      'onnx/model_quantized.onnx': kokoro(
        'onnx/model_quantized.onnx',
        92361116,
        'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
      ),
      'onnx/model.onnx': kokoro(
        'onnx/model.onnx',
        325532232,
        '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb',
      ),
      'voices/af_heart.bin': kokoro(
        'voices/af_heart.bin',
        522240,
        'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
      ),
      'voices/af_alloy.bin': kokoro(
        'voices/af_alloy.bin',
        522240,
        'c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45',
      ),
      'voices/af_aoede.bin': kokoro(
        'voices/af_aoede.bin',
        522240,
        '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361',
      ),
      'voices/af_bella.bin': kokoro(
        'voices/af_bella.bin',
        522240,
        'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b',
      ),
      'voices/af_jessica.bin': kokoro(
        'voices/af_jessica.bin',
        522240,
        'a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8',
      ),
      'voices/af_kore.bin': kokoro(
        'voices/af_kore.bin',
        522240,
        '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e',
      ),
      'voices/af_nicole.bin': kokoro(
        'voices/af_nicole.bin',
        522240,
        'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a',
      ),
      'voices/af_nova.bin': kokoro(
        'voices/af_nova.bin',
        522240,
        '18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f',
      ),
      'voices/af_river.bin': kokoro(
        'voices/af_river.bin',
        522240,
        '00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30',
      ),
      'voices/af_sarah.bin': kokoro(
        'voices/af_sarah.bin',
        522240,
        '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a',
      ),
      'voices/af_sky.bin': kokoro(
        'voices/af_sky.bin',
        522240,
        '4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9',
      ),
      'voices/am_adam.bin': kokoro(
        'voices/am_adam.bin',
        522240,
        '162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716',
      ),
      'voices/am_echo.bin': kokoro(
        'voices/am_echo.bin',
        522240,
        '3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3',
      ),
      'voices/am_eric.bin': kokoro(
        'voices/am_eric.bin',
        522240,
        'e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832',
      ),
      'voices/am_fenrir.bin': kokoro(
        'voices/am_fenrir.bin',
        522240,
        'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43',
      ),
      'voices/am_liam.bin': kokoro(
        'voices/am_liam.bin',
        522240,
        '52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade',
      ),
      'voices/am_michael.bin': kokoro(
        'voices/am_michael.bin',
        522240,
        '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1',
      ),
      'voices/am_onyx.bin': kokoro(
        'voices/am_onyx.bin',
        522240,
        'da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6',
      ),
      'voices/am_puck.bin': kokoro(
        'voices/am_puck.bin',
        522240,
        'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0',
      ),
      'voices/am_santa.bin': kokoro(
        'voices/am_santa.bin',
        522240,
        '61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a',
      ),
      'voices/bf_emma.bin': kokoro(
        'voices/bf_emma.bin',
        522240,
        '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73',
      ),
      'voices/bf_isabella.bin': kokoro(
        'voices/bf_isabella.bin',
        522240,
        '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f',
      ),
      'voices/bm_george.bin': kokoro(
        'voices/bm_george.bin',
        522240,
        'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc',
      ),
      'voices/bm_lewis.bin': kokoro(
        'voices/bm_lewis.bin',
        522240,
        'b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97',
      ),
      'voices/bf_alice.bin': kokoro(
        'voices/bf_alice.bin',
        522240,
        '08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573',
      ),
      'voices/bf_lily.bin': kokoro(
        'voices/bf_lily.bin',
        522240,
        '5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335',
      ),
      'voices/bm_daniel.bin': kokoro(
        'voices/bm_daniel.bin',
        522240,
        '6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8',
      ),
      'voices/bm_fable.bin': kokoro(
        'voices/bm_fable.bin',
        522240,
        'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1',
      ),
    },
  },
} as const satisfies TtsManifest;
