<div align="center">

<img src="icon.svg" width="76" alt="">

# Nítido

### Cull a whole Fujifilm shoot in your browser.<br>Your photos never leave your computer.

Focus measured at 100% on the eyes, the AF point or the subject. Bursts grouped, the best frame picked,<br>
the keepers copied to your NAS. All of it computed on your machine: no server, no upload, no account.

[![Open the app](https://img.shields.io/badge/Open_the_app-5fd394?style=for-the-badge&logoColor=111)](https://brunoaclopes.github.io/nitido/)

![Runs in your browser](https://img.shields.io/badge/runs-100%25_in_your_browser-5fd394)
![No uploads](https://img.shields.io/badge/uploads-none-5fd394)
![Works offline](https://img.shields.io/badge/works-offline-5fd394)
[![CI](https://github.com/brunoaclopes/nitido/actions/workflows/ci.yml/badge.svg)](https://github.com/brunoaclopes/nitido/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/licence-MIT-3a3a3e)](LICENSE)
![No dependencies](https://img.shields.io/badge/dependencies-0-3a3a3e)

**English** · [Português](#português)

<img src="docs/gallery.webp" alt="Gallery: a shoot grouped into similar shots, each photo with its verdict and measured blur, the blur histogram in the side panel" width="100%">

</div>

## Private by design

Nítido has no backend. The site is a handful of static files; once your browser has them, everything happens on your computer:

- **Your photos are read, not sent.** The browser opens the folder you choose and the app reads the files from disk. There is no upload code and no server to upload to.
- **The AI runs locally.** Face, eye and subject detection (MediaPipe) and the similarity model (MobileCLIP or SigLIP) run inside the browser, in web workers and WebAssembly. The models are downloaded *to* you, like any file; your photos are never sent *to* them.
- **Your work stays in your browser.** Measurements, small thumbnails, your decisions and your personal taste model live in the browser's own storage on your computer. Clearing the site's data removes all of it.
- **Your files go straight to your disk.** *Finish* copies the keepers to your NAS or archive drive over your own network, with no cloud in between.
- **No accounts, no analytics, no cookies, no tracking.**
- **Works offline.** Install it from the address bar. After the first analysis, you can turn Wi-Fi off and cull a whole shoot.

```mermaid
flowchart LR
  NET(["Internet<br/>the app · a font · open-source libraries · AI models"]) -- "downloaded once, then cached" --> TAB
  subgraph PC["Your computer"]
    direction LR
    CARD[("Shoot folder<br/>JPEG + RAF")] -- read --> TAB["Browser tab<br/>decode · blur · faces · similarity"]
    TAB -- "results and decisions" --> DB[("Browser storage")]
    TAB -- "keepers, checked copies" --> NAS[("Your NAS or disk")]
  end
```

<sub>The only arrow that crosses the edge of your computer points inwards.</sub>

### Don't take our word for it

- **Watch the network.** Open DevTools → *Network* and analyse a folder. You will only see downloads (`GET`) of the app, its font, the libraries and the models. No request carries a photo or anything else from your computer.
- **Pull the plug.** Once the models are cached, analyse a shoot with the network off. It works the same.
- **The tests check it.** The browser test records every request a full session makes, from the page and its workers: analysing, culling, reanalysing, sorting files, exporting. The run fails if any request is not a plain download from those sources. A 12-photo run against the published site made 390 requests, and every one was a download, from the app's own host and four known sources. The full list is in [`tests/browser.e2e.mjs`](tests/browser.e2e.mjs).

The servers that host the app, the font and the models (GitHub Pages, Google Fonts, jsDelivr, Google's model storage and Hugging Face) see a request from your IP address, as with any website. They never see a photo. To skip them after the first visit, run Nítido locally with the models kept on disk (`npm run models`, see [Use it](#use-it)).

## What it does

| | |
| --- | --- |
| <img src="docs/loupe.webp" alt="Loupe with the sharpness map over a landscape"> | **Judges every photo at 100%.** Blur is measured as edge width in pixels on the eyes, the AF point or the subject, then over the whole frame as a sharpness map. Closed eyes, motion blur, missed focus and blown highlights each get a plain-language reason. |
| <img src="docs/cull.webp" alt="Culling mode showing one group, the suggested best large and the other frames below"> | **Culling mode, one group at a time.** The suggested best is shown large and the rest of the burst sits in a strip. With people in the frame, each face is lined up across the burst, so the frame where everyone's eyes are open stands out. <kbd>Enter</kbd> keeps it and rejects the rest. |
| <img src="docs/finish.webp" alt="Finish dialog: keepers copied to a NAS folder, rejects set aside"> | **Finish, without Lightroom.** Keepers are copied with their RAF to your NAS or archive, and each copy is checked. Rejects are set aside in a `_rejects` folder or deleted. You see how many photos go where before anything happens. |
| <img src="docs/calibrate.webp" alt="Calibration: a 100% crop and the question 'Sharp enough?'"> | **Calibrated to your eye.** You answer "sharp enough?" for twelve crops at 100%, and the sharpness limit fits your answers. A personal model also learns from every keep or reject you make by hand, across shoots. It is trained in your browser and stays there. |

<div align="center">
<img src="docs/phone-gallery.webp" width="30%" alt="The gallery on a phone">&nbsp;&nbsp;<img src="docs/phone-cull.webp" width="30%" alt="Culling mode on a phone">
<br><sub>Works on a phone too, and installs as an app that runs offline.</sub>
</div>

**Also:**
- **Fujifilm film recipes:** the loupe shows the recipe from the camera, with a filter for each film simulation.
- **Compare with synced zoom:** zoom stays in step across the photos you compare.
- **XMP sidecars:** stars, colour labels and keywords for Lightroom, if you use it.
- **Survives a refresh:** reload in the middle of a shoot and nothing is lost.
- **Three themes:** Dark, Light and a Liquid glass theme that really bends light.
- **Two languages:** English and Portuguese.

## Use it

**Online:** open **[brunoaclopes.github.io/nitido](https://brunoaclopes.github.io/nitido/)** in Chrome or Edge and choose your shoot folder: JPEG and RAF together, straight off the card. The AI models download once, 100 to 400 MB depending on the tier, and are cached.

**Locally:** with [Node.js](https://nodejs.org) 18 or newer, there is nothing to install:

```sh
npm start            # opens http://127.0.0.1:4173
npm run models       # optional: keep the AI models in ./models, so nothing is fetched from model hosts
```

**Nothing is lost.**
- Results and your decisions are saved in the browser as you go, so reopening a folder is instant.
- After a refresh in the middle of a shoot, Chrome and Edge reopen the folder by themselves, on the same filters and photo. Other browsers ask for the folder again, and nothing is measured twice.
- **Reanalyse** measures the folder again from scratch, after you change the AI models or add files, and keeps your decisions.

**Theme.** The half-circle button in the top bar switches between three themes:
- **Dark:** neutral greys. It is the default and the best for judging colour.
- **Light:** bright neutral greys, for daylight.
- **Liquid glass:** floating glass panels over a slowly moving wallpaper, in the style of macOS. In Chrome and Edge the glass bends light at its rim like a lens, after [kube.io's write-up](https://kube.io/blog/liquid-glass-css-svg/). It turns solid when the system asks for reduced transparency.

**AI tier.** Under *AI models*, pick how much work the analysis does. The app suggests a tier for your computer from its cores, its memory and the speed of earlier runs.

| Tier | Similarity and quality | Subject detector | Download | Per photo* |
| --- | --- | --- | --- | --- |
| Light | MobileCLIP S0 | EfficientDet-Lite0 | ~100 MB | 0.3 s |
| Standard | MobileCLIP S2 | EfficientDet-Lite0 | ~220 MB | 0.9 s |
| Heavy | SigLIP B/16 | EfficientDet-Lite2 | ~225 MB | 1.5 s |
| Max | SigLIP 2 B/16 | EfficientDet-Lite2, full precision | ~405 MB | 1.5 s |

<sub>*Measured on a 12-core Mac. The similarity model runs in the background while the photos are measured.<br>
SigLIP and SigLIP 2 are the Pareto-optimal models in [Immich's search benchmark](https://docs.immich.app/features/searching): 81.9% and 84.9% recall, against 69.9% for OpenAI's ViT-B/32. MobileCLIP is Apple's lighter family, also ahead of ViT-B/32. Each model's similarity scale was calibrated on X-H2 bursts. `npm run models -- heavy` keeps a tier's models for offline use.</sub>

## A shoot, start to finish

1. **Open the folder** with *Choose folder*, or drop it on the window. Each photo gets **Keep**, **Review** or **Reject**, with the reason.
2. **Cull** with <kbd>T</kbd>: go through the groups and the photos still to review.
   - <kbd>Enter</kbd> keeps the frame shown and rejects the rest.
   - <kbd>P</kbd> or <kbd>X</kbd> decides one photo, and <kbd>↑</kbd> <kbd>↓</kbd> change group.
   - <kbd>Z</kbd> zooms to 100%.
3. **Finish:** pick the NAS folder once (it is remembered) and press Start.
   - Keepers are copied with their RAF and XMP, and so are the photos still to review if you choose. They go into a folder named after the shoot, into date folders (`2026/2026-09-15`), or straight in. Every copy is checked by size. Files already there are skipped, so an interrupted run can simply be repeated. Originals stay where they are.
   - Rejects are set aside in `_rejects` inside the shoot folder (the default), or left alone. You can also delete them for good, after a confirmation, since a browser cannot use the bin. Once you have looked, *Empty* removes the `_rejects` folder.
   - Safari and Firefox cannot write to your folders. There, Finish downloads a `.sh` or `.ps1` script that does the same.

Lightroom is optional: XMP sidecars with stars, colour labels and keywords can be written next to the photos or the copies.

<a name="how-a-photo-is-judged"></a>
<details>
<summary><b>How a photo is judged</b></summary>

1. **Decode** the JPEG (or the RAF's embedded preview) in a worker, in horizontal strips, never holding a full-size canvas.
2. **Find faces and subjects** with MediaPipe: blink probability per eye, smile, head turn, and objects such as cars, animals and people.
3. **Choose where to measure.** In order of preference:
   1. the main face's eyes;
   2. the face;
   3. the camera's own eye and face boxes;
   4. the AF point;
   5. the camera's subject box;
   6. the detected subject;
   7. the sharpest area of the frame.

   People count as the subject only when the camera focused on them. When it focused sharply on something else, background people are ignored, and a prominent soft face only asks for a look (*Person out of focus*).
4. **Measure blur at 100%** as edge width in pixels, with the re-blur method of Zhuo & Sim, sampled on edge centre lines only. Contrast and texture do not change the reading, so a lone crisp edge on smooth car paint or sky measures as sharp.
5. **Compare with neighbours.** A frame much softer at a coarse scale than a similar one shot seconds apart is flagged as shaken. This catches shake that film grain hides.
6. **Group and score with the similarity model** of the AI tier (MobileCLIP or SigLIP). It gives the similarity used for grouping, a quality score and a name for each group ("Sea and beach · 09:31").
7. **Verdict and score:** Keep, Review or Reject with reasons, and a 0–100 score to pick the best of each group.
   - Intentional background blur is recognised and not penalised.
   - Eyes narrowed by a laugh do not count as closed.
   - *Overexposed* means blown skin on the main face or a frame that is mostly pure white, not a white shirt or a sunlit wall.
   - The camera's own flags are named: shake risk, focus not confirmed, exposure. Its shake flag is shown only when the measured blur agrees.

**Fujifilm details.**
- **Film recipe:** the loupe shows the recipe each photo was taken with, as the camera's menus write it:
  - film simulation;
  - dynamic range or D-Range Priority;
  - highlight, shadow and colour;
  - noise reduction, sharpness and clarity;
  - grain, Color Chrome and FX Blue;
  - white balance with its shift;
  - ISO and exposure compensation.

  It also says how many photos in the shoot share the recipe and copies it as text. Each film simulation gets its own filter.
- **AF point:** `FocusPixel` is read in the JPEG's own pixel frame. This was confirmed on 51 sample files, X-H2 included, by the [riffle](https://github.com/minodisk/riffle) project. It is ignored in manual focus, where the camera writes a stale point.
- **Camera boxes:** the camera's own face, eye and subject boxes are used too.
- **Default limits:** calibrated on X-H2 files. Sharp frames read 0.7–1.4 px; visibly soft ones read 2 px and up.

</details>

<details>
<summary><b>Keyboard</b></summary>

| Key | Action |
| --- | --- |
| <kbd>T</kbd> | Culling mode |
| <kbd>Enter</kbd> (culling) | Keep this frame, reject the rest of the group |
| <kbd>←</kbd> <kbd>→</kbd> · <kbd>↑</kbd> <kbd>↓</kbd> | Previous / next photo · group |
| <kbd>P</kbd> <kbd>X</kbd> <kbd>U</kbd> | Keep · reject · back to automatic |
| <kbd>Shift</kbd>+<kbd>X</kbd> | Keep this one and reject the rest of the group |
| <kbd>1</kbd>–<kbd>5</kbd>, <kbd>0</kbd> · <kbd>6</kbd>–<kbd>9</kbd> | Stars, clear · red, yellow, green, blue label |
| <kbd>Z</kbd> · <kbd>M</kbd> <kbd>F</kbd> <kbd>B</kbd> | 100% on focus · sharpness map, faces, focus area |
| <kbd>C</kbd> | Compare the group or the selection, with synchronised zoom |
| <kbd>?</kbd> | All shortcuts |

</details>

## Limitations

- **Texture can hide blur.** A badly blurred or shaken frame can measure as sharp when fine texture is the only crisp detail left: sensor noise, the film simulation's rendering, or Grain Effect. A similar frame shot seconds apart catches it, but a lone frame like that can slip through.
- **Faces:** detection is most reliable on frontal, reasonably large faces. Strong profiles are not counted as closed eyes.
- **Speed:** the similarity model runs in WebAssembly. On slow machines, pick the Light tier, or turn the model off under *AI models*.

## For developers

**Code.** Plain ES modules, with no build step and no dependencies:
- `src/core`: the pure, tested logic (EXIF and Fuji MakerNote, geometry, blur metrics, scoring, grouping, sorting, XMP, ZIP).
- `src/workers`: the pixel and CLIP workers.
- `src/ml`: the MediaPipe and CLIP clients.
- `src/app`: state, pipeline and storage.
- `src/ui`: the views.
- `src/i18n`: English and Portuguese.

**Tests.**

```sh
npm test                                        # unit tests
npm run test:smoke                              # the whole app on a stub DOM
npm run test:browser -- --photos ~/some-shoot   # real headless Chrome and models: screenshots, UI audit, network check; any page error fails (Node ≥ 22)
npm run test:browser -- --photos ~/some-shoot --url https://brunoaclopes.github.io/nitido/   # the same against the published site
node scripts/readme-shots.mjs --photos ~/some-shoot --names DSCF0001,…           # regenerate these screenshots
```

**Hosting.** It is a static site, and a push to `main` deploys it to GitHub Pages. To host it yourself, there is still no server-side code to run:
- with Docker: `docker build -t nitido . && docker run -p 8080:80 nitido`;
- or upload `index.html`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `styles/` and `src/` to any HTTPS host.

---

## Português

### Triagem de fotos Fujifilm no browser. As tuas fotos nunca saem do teu computador.

O Nítido mede o foco a 100% nos olhos, no ponto de AF ou no sujeito. Agrupa as rajadas, escolhe a melhor foto de cada uma e copia as que ficam para o teu NAS. Tudo é calculado na tua máquina: sem servidor, sem uploads, sem conta.

**[Abrir a app →](https://brunoaclopes.github.io/nitido/)**

### Privado por natureza

O Nítido não tem backend. O site é um punhado de ficheiros estáticos; depois de o browser os ter, tudo acontece no teu computador:

- **As fotos são lidas, não enviadas.** O browser abre a pasta que escolhes e a app lê os ficheiros do disco. Não há código de upload nem servidor para onde enviar.
- **A IA corre localmente.** A deteção de rostos, olhos e sujeitos (MediaPipe) e o modelo de semelhança (MobileCLIP ou SigLIP) correm dentro do browser, em web workers e WebAssembly. Os modelos são descarregados *para* ti, como qualquer ficheiro; as fotos nunca são enviadas *para* eles.
- **O teu trabalho fica no browser.** As medições, as miniaturas, as tuas decisões e o teu modelo pessoal ficam guardados no próprio browser, no teu computador. Apagar os dados do site remove tudo.
- **Os ficheiros vão diretos para o teu disco.** *Concluir* copia as fotos para o teu NAS ou disco de arquivo pela tua rede, sem nuvem pelo meio.
- **Sem contas, sem estatísticas, sem cookies, sem rastreio.**
- **Funciona offline.** Instala-a a partir da barra de endereço. Depois da primeira análise, podes desligar o Wi-Fi e triar uma sessão inteira.

**Confirma tu mesmo.**
- Abre as DevTools → *Network* e analisa uma pasta: só vês descarregamentos (`GET`) da app, da fonte, das bibliotecas e dos modelos.
- Com os modelos em cache, desliga a rede: a análise funciona na mesma.
- O teste de browser regista todos os pedidos de uma sessão completa e falha se algum não for um simples descarregamento.

Os servidores que alojam a app, a fonte e os modelos veem um pedido vindo do teu IP, como em qualquer site, mas nunca uma foto.

### Usar

**Online:** abre **[brunoaclopes.github.io/nitido](https://brunoaclopes.github.io/nitido/)** no Chrome ou no Edge e escolhe a pasta da sessão: JPEG e RAF juntos, como saem do cartão. Os modelos de IA descarregam-se uma vez, 100 a 400 MB conforme o nível, e ficam em cache.

**No teu computador:** com o [Node.js](https://nodejs.org) 18 ou mais recente, não há nada para instalar:

```sh
npm start            # abre http://127.0.0.1:4173
npm run models       # opcional: guarda os modelos em ./models, para não os ir buscar a nenhum servidor
```

**Nada se perde.**
- Os resultados e as decisões ficam guardados à medida que avanças, por isso reabrir uma pasta é imediato.
- Depois de um refresh a meio da sessão, o Chrome e o Edge reabrem a pasta sozinhos, nos mesmos filtros e na mesma foto. Os outros browsers pedem a pasta outra vez, e nada é medido duas vezes.
- **Reanalisar** mede a pasta de raiz, depois de mudares os modelos de IA ou juntares ficheiros, e mantém as tuas decisões.

**Temas:**
- **Escuro:** o predefinido e o melhor para julgar a cor.
- **Claro:** para a luz do dia.
- **Vidro líquido:** painéis de vidro sobre um fundo em movimento lento, ao estilo do macOS. No Chrome e no Edge o vidro dobra mesmo a luz.

**Níveis de IA:**
- **Leve:** MobileCLIP S0, ~100 MB.
- **Normal:** MobileCLIP S2, ~220 MB.
- **Pesado:** SigLIP B/16, ~225 MB.
- **Máximo:** SigLIP 2 B/16, ~405 MB.

A app sugere um nível para o teu computador. Os tempos medidos estão [na tabela em inglês](#use-it).

### Uma sessão, do início ao fim

1. **Abre a pasta** com *Escolher pasta*, ou arrasta-a para a janela. Cada foto fica **Manter**, **Rever** ou **Rejeitar**, com o motivo.
2. **Tria** com <kbd>T</kbd>, um grupo de cada vez.
   - A melhor sugerida aparece grande e as outras numa fila.
   - Com pessoas, cada rosto aparece em todas as fotos da rajada, para veres logo onde estão todos de olhos abertos.
   - <kbd>Enter</kbd> mantém a foto mostrada e rejeita as outras, <kbd>P</kbd> ou <kbd>X</kbd> decide uma foto, e <kbd>Z</kbd> dá zoom a 100%.
3. **Conclui:** escolhe a pasta do NAS uma vez (fica lembrada) e carrega em Começar.
   - As fotos a manter são copiadas com o RAF e o XMP, e cada cópia é verificada. Os originais ficam onde estão.
   - As rejeitadas ficam de parte em `_rejeitadas`, ou são apagadas de vez depois de confirmares.
   - No Safari e no Firefox, Concluir descarrega um script `.sh` ou `.ps1` que faz o mesmo.

O Lightroom é opcional: os XMP com estrelas, etiquetas de cor e palavras-chave podem ser escritos ao lado das fotos ou das cópias.

### Ajustar ao teu gosto

- **Calibrar ao teu olho:** respondes "nítida o suficiente?" a 12 recortes a 100%, e o limite de nitidez ajusta-se às tuas respostas.
- **Modelo pessoal:** aprende com cada foto que manténs ou rejeitas à mão, em todas as sessões. É treinado no teu browser e fica lá.
  - Rejeitar "o resto do grupo" não conta, porque essas fotos são repetidas, não más.
  - Liga-se sozinho com 30 decisões e 85% de acerto.
  - Desliga-o ou fá-lo esquecer nos *Modelos de IA*.

### Limitações

- **A textura pode esconder o desfoque.** Uma foto desfocada ou tremida pode medir como nítida quando a textura fina é o único detalhe nítido que resta: ruído, a simulação de filme ou o Grain Effect. Uma foto parecida tirada segundos antes ou depois apanha-a.
- **Rostos:** a deteção é mais fiável em rostos de frente e razoavelmente grandes.
- **Velocidade:** em máquinas lentas, escolhe o nível Leve.

O funcionamento detalhado, os atalhos e as notas para programadores estão [na versão inglesa](#how-a-photo-is-judged).
