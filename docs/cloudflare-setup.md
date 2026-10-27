# Sincronização própria com Cloudflare

Este guia configura sua própria instância do Five. Você precisará de uma conta Cloudflare, um Worker, um banco D1 e um aplicativo Cloudflare Access. Não compartilhe seus tokens, IDs ou secrets em commits, issues ou capturas de tela.

## 1. Criar uma cópia e instalar

Crie seu repositório usando **Use this template** no GitHub e clone-o. Na raiz do projeto, copie a configuração de exemplo:

```sh
cp wrangler.example.jsonc wrangler.jsonc
pnpm install
```

No PowerShell, use:

```powershell
Copy-Item wrangler.example.jsonc wrangler.jsonc
pnpm install
```

`wrangler.jsonc` está no `.gitignore`; edições nele permanecem locais. Não remova essa regra.

## 2. Criar seu banco D1

Autentique o Wrangler e crie um banco com um nome seu:

```sh
pnpm wrangler login
pnpm wrangler d1 create five-notes-seu-nome
```

Copie o `database_id` retornado. No seu `wrangler.jsonc`, atualize:

- `name` para um nome de Worker seu, por exemplo `five-notes-seu-nome`;
- `database_name` para o nome D1 criado;
- `database_id` para o ID retornado;
- `routes` somente se for configurar seu próprio domínio.

Mantenha o binding `FIVE_DB` e `migrations_dir` como estão. A configuração precisa de um `database_id` no binding D1; veja [a referência de configuração do Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/).

## 3. Testar localmente

Antes de publicar, aplique as migrações no D1 local e abra o app:

```sh
pnpm db:migrate:local
pnpm dev
```

O Wrangler guarda esse banco local em `.wrangler/`. O ID fictício do exemplo funciona para o modo local; substitua-o pelo ID do seu banco antes de executar qualquer comando remoto. A integração local pode ser testada com o servidor Vite rodando em outro terminal:

```sh
pnpm test:integration
```

## 4. Migrar o D1 remoto e publicar

Confirme que `wrangler.jsonc` contém o ID do seu D1 e o nome do seu Worker, depois aplique o schema e publique:

```sh
pnpm db:migrate:remote
pnpm cf:deploy
```

O comando imprime o endereço `workers.dev` do seu Worker. Não armazene dados pessoais até terminar de configurar e testar o Cloudflare Access na etapa seguinte. Sem `ACCESS_ISSUER` e `ACCESS_AUD`, o Worker rejeita com HTTP 401 todas as requisições remotas `/api/*`.

## 5. Proteger o Worker com Cloudflare Access

Ative o Cloudflare Zero Trust na conta e configure pelo menos um método de autenticação. No Cloudflare Dashboard, abra **Workers & Pages → seu Worker → Access → Protect this Worker behind Access**, escolha **All traffic** e configure uma política **Allow** para a identidade que terá acesso ao caderno. A documentação oficial descreve o fluxo em [Cloudflare Access para Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

Essa opção protege o Worker, incluindo seu endereço `workers.dev` e os domínios personalizados associados. Use uma política que permita somente as identidades pretendidas. Para um caderno individual, One-time PIN por e-mail é uma opção simples.

Na configuração do aplicativo Access, anote:

- **Team domain / Issuer**, normalmente `https://<sua-equipe>.cloudflareaccess.com`;
- **Application Audience (AUD) Tag**.

Grave os valores como secrets do seu Worker. Cada comando solicita o valor sem colocá-lo no shell history:

```sh
pnpm wrangler secret put ACCESS_ISSUER
pnpm wrangler secret put ACCESS_AUD
pnpm cf:deploy
```

O Worker valida a assinatura, o issuer e a audience do JWT de Access em cada endpoint `/api/*`. Sem os dois secrets, ou com um token inválido, a API falha fechada.

## 6. Verificar login e sincronização

1. Abra seu endereço `workers.dev` numa janela privada. O Cloudflare Access deve solicitar autenticação.
2. Entre com uma identidade permitida.
3. Crie uma nota de teste e confirme que o estado de sincronização muda para sincronizado.
4. Abra o mesmo endereço em outro navegador ou dispositivo, autentique-se e confirme que a nota aparece.
5. Sem autenticação, o Access deve bloquear as chamadas de dados e encaminhar o navegador para o login. Depois de autenticar, `GET /api/health` deve retornar `{"status":"ok"}`.
6. Exporte um backup JSON e guarde-o em local seguro.

Se a tela abrir, mas os dados não sincronizarem, confira se os secrets pertencem ao aplicativo Access que protege esse Worker e se o D1 configurado corresponde ao banco onde as migrações foram aplicadas.

## Domínio próprio opcional

Você pode associar um domínio seu depois de validar o endereço `workers.dev`. Adicione um Custom Domain em `routes` no `wrangler.jsonc` ou em **Workers & Pages → seu Worker → Settings → Domains & Routes → Add → Custom Domain**. A zona DNS precisa estar disponível na sua conta Cloudflare. Mantenha o Access **All traffic** ativo para proteger também o domínio associado. Veja [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Não adicione o domínio ou as rotas de outra pessoa. O exemplo não declara rota de domínio.

## Backup e migrações

- Use **Exportar backup** no Five para gerar um arquivo JSON portátil.
- Exporte o D1 remoto com `pnpm wrangler d1 export <nome-do-seu-d1> --remote --output ./five-d1-backup.sql`. Mantenha esse arquivo fora do Git; o `.gitignore` ignora exports SQL.
- As migrações ficam em `migrations/`. Depois de aplicadas, crie uma nova migração para alterações futuras em vez de editar uma migração já publicada.

## Referências oficiais

- [Criar um banco D1](https://developers.cloudflare.com/d1/get-started/)
- [Configuração do Wrangler e binding D1](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Comandos e migrações D1](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare Access para Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Secrets de Worker](https://developers.cloudflare.com/workers/configuration/secrets/)
