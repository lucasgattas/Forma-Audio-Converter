# Assinatura de código no Windows

Estado em 07/11/2026: **os instaladores saem sem assinatura**.
Consequência prática: o Windows mostra "editor desconhecido" (unknown publisher) e o
SmartScreen pode exibir "O Windows protegeu o PC" até o arquivo ganhar reputação.
Não existe atalho honesto para isso: ou o binário é assinado, ou o aviso aparece.

## O que já está verificado nesta máquina

- Nenhum certificado de assinatura de código instalado para o usuário atual
  (`Cert:\CurrentUser\My -CodeSigningCert` retorna vazio).
- `signtool.exe` disponível no Windows SDK (`C:\Program Files (x86)\Windows Kits\10\bin`).
- O projeto Tauri tem o suporte de assinatura pronto para ser ligado, sem mudança de código.

## O que falta, e depende de você

Um certificado de assinatura de código Autenticode emitido por uma CA. As opções reais:

| Tipo | O que exige | Efeito no SmartScreen |
|---|---|---|
| OV (Organization Validation) | CNPJ/documento da empresa, verificação de identidade e telefone, chave em arquivo ou token | reputação começa do zero e é construída com downloads |
| EV (Extended Validation) | o mesmo mais validação estendida e chave em token/HSM obrigatório | reputação de SmartScreen imediata |
| Azure Trusted Signing | conta Azure, validação de identidade da organização, taxa mensal | assina na nuvem, sem token físico |

Faixa de preço atual: OV de algumas centenas de reais por ano, EV bem acima disso,
Trusted Signing com mensalidade. Isso é custo e decisão sua, não meu.

Enquanto o projeto for MIT e gratuito, a alternativa aceitável é documentar o aviso
("instalador não assinado, o Windows vai pedir confirmação") e publicar o SHA-256 de cada
ativo na release, que é o que já acontece.

## Como ligar quando o certificado existir

1. Instalar o certificado no repositório do usuário ou da máquina, com chave privada.
2. Descobrir o thumbprint:
   `powershell -NoProfile -Command "Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object Subject,Thumbprint"`
3. Acrescentar ao `src-tauri/tauri.public-release.conf.json`, dentro de `bundle`:

   ```json
   "windows": {
     "certificateThumbprint": "A1B2C3...",
     "digestAlgorithm": "sha256",
     "timestampUrl": "http://timestamp.digicert.com"
   }
   ```

   Se a chave estiver em token/HSM, o caminho é `signCommand` apontando para
   `signtool sign /sha1 <thumbprint> /tr <timestampUrl> /td sha256 /fd sha256 %1`.
4. Recompilar com a mesma receita já usada para o instalador privado.
5. Verificar o resultado no próprio arquivo, não no log do build:

   ```
   signtool verify /pa /v "Forma Audio Converter_0.1.2_x64-setup.exe"
   powershell -NoProfile -Command "(Get-AuthenticodeSignature 'arquivo.exe').Status"
   ```

   Esperado: `Valid` e assinatura com carimbo de tempo.
6. Só então publicar. Um instalador assinado depois de publicado não resolve o aviso
   para quem já baixou.

## O que a assinatura cobre e não cobre

- Cobre o instalador e o executável principal; as 18 DLLs/EXEs do FFmpeg continuam sem
  assinatura, o que é normal para binários de terceiros.
- Não substitui os avisos de licença. As obrigações de terceiros estão em
  `THIRD-PARTY-NOTICES.txt` e `docs/ffmpeg-own-evidence/`.
- Não elimina a auditoria de antivírus: o Defender já bloqueou uma pasta de destino
  durante uma conversão, e isso é comportamento de varredura, não de assinatura.
