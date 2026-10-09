<div align="center">

<img src="icon.svg" width="72" alt="">

# Nítido

**Photo culling in the browser, tuned for Fujifilm.**<br>
Focus measured where it matters, similar shots grouped, the best one picked,<br>
and the keepers sorted onto your NAS. No photo leaves your computer.

[![Open the app](https://img.shields.io/badge/Open_the_app-5fd394?style=for-the-badge&logoColor=111)](https://brunoaclopes.github.io/nitido/)

[![CI](https://github.com/brunoaclopes/nitido/actions/workflows/ci.yml/badge.svg)](https://github.com/brunoaclopes/nitido/actions/workflows/ci.yml)
[![Pages](https://github.com/brunoaclopes/nitido/actions/workflows/pages.yml/badge.svg)](https://github.com/brunoaclopes/nitido/actions/workflows/pages.yml)
[![MIT](https://img.shields.io/badge/licence-MIT-3a3a3e)](LICENSE)
![No dependencies](https://img.shields.io/badge/dependencies-0-3a3a3e)

**English** · [Português](#português)

<img src="docs/gallery.webp" alt="Gallery: a shoot grouped into similar shots, each photo with its verdict and measured blur, the blur histogram in the side panel" width="100%">

</div>

## What it does

| | |
| --- | --- |
| <img src="docs/loupe.webp" alt="Loupe with the sharpness map over a landscape"> | **Judges every photo at 100%.** Blur is measured as edge width in pixels on the eyes, the AF point or the subject, then over the whole frame as a sharpness map. Closed eyes, motion blur, missed focus and blown highlights each get a plain-language reason. |
| <img src="docs/cull.webp" alt="Culling mode showing one group, the suggested best large and the other frames below"> | **Culling mode, one group at a time.** The suggested best is shown large and the rest of the burst sits in a strip. With people in the frame, each face is lined up across the burst, so the frame where everyone's eyes are open stands out. <kbd>Enter</kbd> keeps it and rejects the rest. |
| <img src="docs/finish.webp" alt="Finish dialog: keepers copied to a NAS folder, rejects set aside"> | **Finish, without Lightroom.** Keepers are copied with their RAF to your NAS or archive, each copy checked; rejects are set aside in a `_rejects` folder or deleted. You see how many photos go where before anything happens. |
| <img src="docs/calibrate.webp" alt="Calibration: a 100% crop and the question 'Sharp enough?'"> | **Calibrated to your eye.** Twelve crops at 100%, "sharp enough?" for each, and the sharpness limit fits your answers. A personal model also learns from every keep or reject you make by hand, across shoots. |

<div align="center">
<img src="docs/phone-gallery.webp" width="30%" alt="The gallery on a phone">&nbsp;&nbsp;<img src="docs/phone-cull.webp" width="30%" alt="Culling mode on a phone">
<br><sub>Works on a phone too, and installs as an app that runs offline.</sub>
</div>

## Use it

**Online:** open **[brunoaclopes.github.io/nitido](https://brunoaclopes.github.io/nitido/)** in Chrome or Edge and choose your shoot folder (JPEG and RAF together, straight off the card). Everything runs in your browser; the AI models download once (100–400 MB, by tier).

**Locally:** with [Node.js](https://nodejs.org) 18 or newer, there is nothing to install:

```sh
npm start            # opens http://127.0.0.1:4173
npm run models       # optional: keep the AI models in ./models to work fully offline
```

Reopening a folder is instant: results and your decisions are kept in the browser. After changing the AI models, or to pick up files added to the folder, **Reanalyse** measures it again from scratch and keeps your decisions.

**Theme.** The half-circle button in the top bar switches between **Dark** (neutral greys, the default and the best for judging colour), **Light** and **Liquid glass** (floating glass panels and capsule controls in the style of macOS; it turns solid when the system asks for reduced transparency).

**AI tier.** Under *AI models*, pick how much work the analysis does; the app suggests one for your computer from its cores, memory and the speed of earlier runs.

| Tier | Similarity and quality | Subject detector | Download | Per photo* |
| --- | --- | --- | --- | --- |
| Light | MobileCLIP S0 | EfficientDet-Lite0 | ~100 MB | 0.3 s |
| Standard | MobileCLIP S2 | EfficientDet-Lite0 | ~220 MB | 0.9 s |
| Heavy | SigLIP B/16 | EfficientDet-Lite2 | ~225 MB | 1.5 s |
| Max | SigLIP 2 B/16 | EfficientDet-Lite2, full precision | ~405 MB | 1.5 s |

<sub>*Measured on a 12-core Mac; it runs in the background while the photos are measured. SigLIP and SigLIP 2 are the Pareto-optimal models in [Immich's search benchmark](https://docs.immich.app/features/searching) (81.9% and 84.9% recall against 69.9% for OpenAI's ViT-B/32); MobileCLIP is Apple's lighter family, ahead of ViT-B/32. Each model's similarity scale was calibrated on X-H2 bursts. `npm run models -- heavy` keeps a tier's models for offline use.</sub>

## A shoot, start to finish

1. **Open the folder** with *Choose folder* (or drop it on the window). Each photo gets **Keep**, **Review** or **Reject**, with the reason.
2. **Cull** with <kbd>T</kbd>: go through the groups and the photos still to review. <kbd>Enter</kbd> keeps the frame shown and rejects the rest; <kbd>P</kbd> / <kbd>X</kbd> decide one photo; <kbd>↑</kbd> <kbd>↓</kbd> change group; <kbd>Z</kbd> zooms to 100%.
3. **Finish**: pick the NAS folder once (it is remembered) and press Start.
   - Keepers, and by choice the photos still to review, are copied with their RAF and XMP: into a folder named after the shoot, by capture date (`2026/2026-09-15`) or straight in. Every copy is checked by size; files already there are skipped, so an interrupted run can simply be repeated. Originals stay where they are.
   - Rejects are set aside in `_rejects` inside the shoot folder (the default), deleted for good after a confirmation (a browser cannot use the bin), or left alone. Once you have looked, *Empty* removes the folder.
   - Safari and Firefox cannot write to your folders: there, Finish downloads a `.sh` or `.ps1` script that does the same.

Lightroom is optional: XMP sidecars with stars, colour labels and keywords can still be written next to the photos or the copies.

## How a photo is judged

1. **Decode** the JPEG (or the RAF's embedded preview) in a worker, in horizontal strips, never holding a full-size canvas.
2. **Find faces and subjects** with MediaPipe: blink probability per eye, smile, head turn, and objects such as cars, animals and people.
3. **Choose where to measure**, in this order: the main face's eyes, the face, the camera's own eye and face boxes, the AF point, the camera's subject box, the detected subject, and finally the sharpest area of the frame. People count as the subject only when the camera focused on them: when it focused sharply on something else, background people are ignored and a prominent soft face only asks for a look (*Person out of focus*).
4. **Measure blur at 100%** as edge width in pixels, with the re-blur method of Zhuo & Sim sampled on edge centre lines only. Contrast and texture do not change the reading, so a lone crisp edge on smooth car paint or sky measures as sharp.
5. **Compare with neighbours**: a frame much softer at a coarse scale than a similar one shot seconds apart is flagged as shaken, which catches shake that film grain hides.
6. **The similarity model** of the AI tier (MobileCLIP or SigLIP) gives the similarity used for grouping, a quality score and a name for each group ("Sea and beach · 09:31").
7. **Verdict and score**: Keep, Review or Reject with reasons, and a 0–100 score to pick the best of each group. Intentional background blur is recognised and not penalised; eyes narrowed by a laugh are not counted as closed; *Overexposed* means blown skin on the main face or a frame that is mostly pure white, not a white shirt or a sunlit wall. The camera's own flags are named (shake risk, focus not confirmed, exposure), and its shake flag is shown only when the measured blur agrees.

**Fujifilm details.** The loupe shows the **film recipe** each photo was taken with, as the camera's menus write it: film simulation, dynamic range or D-Range Priority, highlight, shadow, colour, noise reduction, sharpness, clarity, grain, Color Chrome and FX Blue, white balance with its shift, ISO and exposure compensation. It says how many photos in the shoot share it, copies it as text, and each film simulation gets its own filter. `FocusPixel` is read in the JPEG's own pixel frame (confirmed on 51 sample files, X-H2 included, by the [riffle](https://github.com/minodisk/riffle) project) and ignored in manual focus, where the camera writes a stale point. The camera's own face, eye and subject boxes are used too. Default limits were calibrated on X-H2 files: sharp frames read 0.7–1.4 px, visibly soft ones 2 px and up.

## Keyboard

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

## Limitations

- A badly blurred or shaken frame can measure as sharp when fine texture (sensor noise, the film simulation's rendering, Grain Effect) is the only crisp detail left. A similar frame shot seconds apart catches it; a lone frame like that can slip through.
- Face detection is most reliable on frontal, reasonably large faces. Strong profiles are not counted as closed eyes.
- The similarity model runs in WebAssembly; on slow machines pick the Light tier, or turn it off under *AI models*.

## For developers

Plain ES modules, no build step, no dependencies. `src/core` holds the pure, tested logic (EXIF and Fuji MakerNote, geometry, blur metrics, scoring, grouping, sorting, XMP, ZIP); `src/workers` the pixel and CLIP workers; `src/ml` the MediaPipe and CLIP clients; `src/app` state, pipeline and storage; `src/ui` the views; `src/i18n` Portuguese and English.

```sh
npm test                                        # unit tests
npm run test:smoke                              # the whole app on a stub DOM
npm run test:browser -- --photos ~/some-shoot   # real headless Chrome and models, screenshots, any page error fails (Node ≥ 22)
npm run test:browser -- --photos ~/some-shoot --url https://brunoaclopes.github.io/nitido/   # the published site
node scripts/readme-shots.mjs --photos ~/some-shoot --names DSCF0001,…           # regenerate these screenshots
```

It is a static site: the push to `main` deploys it to GitHub Pages. To host it elsewhere, `docker build -t nitido . && docker run -p 8080:80 nitido`, or upload `index.html`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `styles/` and `src/` to any HTTPS host.

---

## Português

**Triagem de fotos no browser, afinada para Fujifilm.** Mede o foco onde importa, agrupa as fotos parecidas, escolhe a melhor de cada grupo e arruma as que ficam no teu NAS. Nenhuma foto sai do teu computador.

### Usar

**Online:** abre **[brunoaclopes.github.io/nitido](https://brunoaclopes.github.io/nitido/)** no Chrome ou no Edge e escolhe a pasta da sessão (JPEG e RAF juntos, como saem do cartão). Tudo corre no teu browser; os modelos de IA descarregam-se uma vez (100–400 MB, conforme o nível).

**No teu computador:** com o [Node.js](https://nodejs.org) 18 ou mais recente, não há nada para instalar:

```sh
npm start            # abre http://127.0.0.1:4173
npm run models       # opcional: guarda os modelos em ./models para funcionar totalmente offline
```

Reabrir uma pasta é imediato: os resultados e as tuas decisões ficam guardados no browser. Depois de mudares os modelos de IA, ou para apanhar ficheiros novos na pasta, **Reanalisar** mede-a outra vez de raiz e mantém as tuas decisões.

**Tema.** O botão do meio círculo na barra de cima muda entre **Escuro** (cinzentos neutros, o predefinido e o melhor para julgar a cor), **Claro** e **Vidro líquido** (painéis de vidro flutuantes e controlos em cápsula, ao estilo do macOS; fica opaco quando o sistema pede menos transparência).

**Nível de IA.** Nos *Modelos de IA* escolhes quanto trabalho faz a análise: Leve (MobileCLIP S0, ~100 MB), Normal (MobileCLIP S2, ~220 MB), Pesado (SigLIP B/16, ~225 MB) ou Máximo (SigLIP 2 B/16, ~405 MB). A app sugere um para o teu computador a partir dos núcleos, da memória e da velocidade das análises anteriores. A tabela com os tempos medidos está [na versão inglesa](#use-it).

### Uma sessão, do início ao fim

1. **Abre a pasta** com *Escolher pasta* (ou arrasta-a para a janela). Cada foto fica **Manter**, **Rever** ou **Rejeitar**, com o motivo.
2. **Tria** com <kbd>T</kbd>: um grupo de cada vez, mais as fotos por rever. A melhor sugerida aparece grande e as outras numa fila; com pessoas, cada rosto aparece em todas as fotos da rajada, para veres logo onde estão todos de olhos abertos. <kbd>Enter</kbd> mantém a foto mostrada e rejeita as outras; <kbd>P</kbd> / <kbd>X</kbd> decidem uma foto; <kbd>↑</kbd> <kbd>↓</kbd> mudam de grupo; <kbd>Z</kbd> dá zoom a 100%.
3. **Conclui**: escolhe a pasta do NAS uma vez (fica lembrada) e carrega em Começar.
   - As fotos a manter, e se quiseres as que estão por rever, são copiadas com o RAF e o XMP: para uma pasta com o nome da sessão, por data (`2026/2026-09-15`) ou diretamente. Cada cópia é verificada pelo tamanho e os ficheiros que já lá estão são saltados, por isso se for interrompido basta correr outra vez. Os originais ficam onde estão.
   - As rejeitadas ficam de parte em `_rejeitadas` dentro da pasta da sessão (por omissão), são apagadas de vez depois de confirmares (o browser não consegue usar o lixo) ou ficam onde estão. Depois de as veres, *Esvaziar* apaga a pasta.
   - O Safari e o Firefox não conseguem escrever nas tuas pastas: aí, Concluir descarrega um script `.sh` ou `.ps1` que faz o mesmo.

O Lightroom é opcional: os XMP com estrelas, etiquetas de cor e palavras-chave podem continuar a ser escritos ao lado das fotos ou das cópias.

### Ajustar ao teu gosto

- **Calibrar ao teu olho**: no painel da visão geral, 12 recortes a 100% e "nítida o suficiente?" para cada um; o limite de nitidez ajusta-se às tuas respostas.
- **Modelo pessoal**: aprende com cada foto que manténs ou rejeitas à mão, em todas as sessões. Rejeitar "o resto do grupo" não conta, porque essas fotos são repetidas, não más. Com 30 decisões e 85% de acerto liga-se sozinho; desliga-o ou fá-lo esquecer nos *Modelos de IA*.
- **Instalar**: no Chrome ou no Edge, instala-o a partir da barra de endereço; depois da primeira análise funciona sem internet.

### Como avalia cada foto

1. **Descodifica** o JPEG (ou a pré-visualização do RAF) num worker, em faixas, sem nunca criar um canvas do tamanho da foto.
2. **Encontra rostos e sujeitos** com MediaPipe: probabilidade de piscar de cada olho, sorriso, orientação do rosto, e objetos como carros, animais e pessoas.
3. **Escolhe onde medir**, por esta ordem: olhos do rosto principal, rosto, olhos e rosto detetados pela câmara, ponto de AF, sujeito da câmara, sujeito detetado e, por fim, a zona mais nítida. As pessoas só contam como sujeito quando a câmara focou nelas: se focou nítido noutra coisa, as pessoas ao fundo são ignoradas e um rosto grande desfocado só pede para veres (*Pessoa desfocada*).
4. **Mede o desfoque a 100%** em píxeis de largura de aresta (método de re-blur de Zhuo & Sim, medido só no centro das arestas). Não depende do contraste nem da textura, por isso uma aresta nítida numa pintura lisa ou no céu mede como nítida.
5. **Compara com as vizinhas**: uma foto muito menos nítida a escala grosseira do que uma parecida tirada segundos antes ou depois é marcada como tremida; isto apanha o tremido que o grão esconde.
6. **O modelo de semelhança** do nível de IA (MobileCLIP ou SigLIP) dá a semelhança para agrupar, uma pontuação de qualidade e um nome para cada grupo ("Mar e praia · 09:31").
7. **Veredicto e pontuação**: Manter, Rever ou Rejeitar com motivos, e uma pontuação de 0 a 100 para escolher a melhor do grupo. O fundo desfocado intencional não penaliza, olhos semicerrados a rir não contam como fechados, e *Sobre-exposta* quer dizer pele queimada no rosto principal ou uma imagem quase toda branca, não uma camisa branca ou uma parede ao sol. Os avisos da própria câmara aparecem com nome (risco de tremido, foco não confirmado, exposição), e o de tremido só quando o desfoque medido o confirma.

**Detalhes Fujifilm.** A lupa mostra a **receita** com que cada foto foi tirada, como nos menus da câmara: simulação de filme, gama dinâmica ou Prioridade D-Range, altas luzes, sombras, cor, redução de ruído, nitidez, claridade, grão, Color Chrome e FX Blue, equilíbrio de brancos com o desvio, ISO e compensação de exposição. Diz quantas fotos da sessão a partilham, copia-a como texto, e cada simulação de filme tem o seu filtro. O `FocusPixel` é lido no referencial do próprio JPEG (confirmado em 51 ficheiros, X-H2 incluída, pelo projeto [riffle](https://github.com/minodisk/riffle)) e ignorado em foco manual, onde a câmara escreve um ponto antigo. Os rostos, olhos e sujeitos detetados pela câmara também são usados. Os limites por omissão foram calibrados com ficheiros da X-H2: fotos nítidas medem 0,7–1,4 px, as visivelmente desfocadas 2 px ou mais.

### Atalhos

| Tecla | Ação |
| --- | --- |
| <kbd>T</kbd> | Modo de triagem |
| <kbd>Enter</kbd> (triagem) | Manter esta e rejeitar as outras do grupo |
| <kbd>←</kbd> <kbd>→</kbd> · <kbd>↑</kbd> <kbd>↓</kbd> | Foto · grupo anterior ou seguinte |
| <kbd>P</kbd> <kbd>X</kbd> <kbd>U</kbd> | Manter · rejeitar · automático |
| <kbd>Shift</kbd>+<kbd>X</kbd> | Manter esta e rejeitar o resto do grupo |
| <kbd>1</kbd>–<kbd>5</kbd>, <kbd>0</kbd> · <kbd>6</kbd>–<kbd>9</kbd> | Estrelas, limpar · etiqueta vermelha, amarela, verde, azul |
| <kbd>Z</kbd> · <kbd>M</kbd> <kbd>F</kbd> <kbd>B</kbd> | 100% no foco · mapa de nitidez, rostos, zona de foco |
| <kbd>C</kbd> | Comparar o grupo ou a seleção, com zoom sincronizado |
| <kbd>?</kbd> | Todos os atalhos |

### Limitações

- Uma foto muito desfocada ou tremida pode medir como nítida quando a textura fina (ruído do sensor, o desenho da simulação de filme, o Grain Effect) é o único detalhe nítido que resta. Uma foto parecida tirada segundos antes ou depois apanha-a; uma foto isolada assim pode escapar.
- A deteção de rostos é mais fiável em rostos de frente e razoavelmente grandes. Perfis pronunciados não contam como olhos fechados.
- O modelo de semelhança corre em WebAssembly; em máquinas lentas escolhe o nível Leve, ou desliga-o nos *Modelos de IA*.

Para programadores, os testes e o alojamento estão descritos [em inglês, acima](#for-developers).
