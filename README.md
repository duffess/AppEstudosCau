# Study Space

Plataforma de estudos e aprendizagem ativa em português. A aplicação reúne biblioteca de materiais, organização por espaços/cadernos/assuntos, geração fundamentada por IA, avaliação, flashcards, planejamento e revisão espaçada.

## Requisitos

- Node.js 20 ou superior.
- Uma chave da API da OpenAI para habilitar a geração de resumos, questões e flashcards.
- SMTP opcional para recuperação de senha por e-mail.

## Executar localmente

```powershell
npm install
Copy-Item .env.example .env
```

Edite `.env` e configure um `SESSION_SECRET` longo. Para habilitar IA, preencha `OPENAI_API_KEY`. Inicie o servidor:

```powershell
npm start
```

Abra [http://localhost:3000](http://localhost:3000) e crie uma conta. O modo `npm run dev` reinicia o servidor quando os arquivos mudam.

## Funcionalidades

### Conta e espaços

- Cadastro e login com sessão assinada em cookie HTTP-only.
- Recuperação de senha por e-mail quando as configurações SMTP estão preenchidas.
- Perfil, alteração de senha, exportação JSON e exclusão da conta.
- Espaços de estudo separados e cadernos independentes.

### Biblioteca e processamento

- Assuntos com prioridade, tempo estimado, data de avaliação e caderno.
- Upload privado de PDF, DOCX, PPTX, TXT, MD, CSV e importação de páginas HTTPS, PDFs e arquivos de texto por URL.
- Versionamento de materiais, metadados editáveis, download e exclusão.
- Processamento em segundo plano com fila persistida, tentativas, status e mensagem de falha.
- Extração de PDF com texto, DOCX, PPTX e texto simples; divisão em trechos e busca textual escopada ao espaço.

### Estúdio de conhecimento e avaliação

- Geração com IA de resumos, guias, apostilas, tabelas, mapas conceituais, fichamentos, flashcards, conceitos, roteiros e aprofundamentos.
- Recuperação de trechos das fontes selecionadas; materiais guardam referências, trechos e histórico de versões.
- Geração de questões de múltipla escolha, verdadeiro/falso, resposta curta, lacunas e casos.
- Correção objetiva ou discursiva assistida por IA, explicação e registro por tentativa.
- Flashcards manuais e gerados, com repetição baseada em facilidade e intervalo.

### Planejamento e acompanhamento

- Planejamento semanal que considera disponibilidade, revisões pendentes, prioridade e domínio por assunto.
- Atividades reprogramáveis e concluíveis.
- Ciclos de revisão de 7, 14, 21 e 30 dias, contados a partir da conclusão do estudo inicial.
- Dashboard, histórico de respostas, taxa de acertos, progresso por assunto e evolução diária.

## Armazenamento e segurança

- SQLite é executado em WebAssembly e persistido em `data/studyspace.sqlite`; arquivos enviados ficam em `data/uploads/`.
- `data/` e `.env` são ignorados pelo Git.
- Senhas usam PBKDF2 com salt individual; uploads são privados e servidos após validar conta e espaço.
- Para produção, use HTTPS, um `SESSION_SECRET` exclusivo, backups protegidos, armazenamento privado com política de retenção e um serviço de banco/arquivos adequado ao ambiente de hospedagem.

## Integração de IA

O servidor usa a API Responses da OpenAI quando `OPENAI_API_KEY` está configurada. A chave não é enviada ao navegador. O prompt inclui apenas trechos recuperados de documentos do espaço e fontes explicitamente escolhidas. A interface mantém a configuração e as fontes associadas a cada material gerado. A disponibilidade de geração depende do provedor configurado e de sua rede.

## Limitações conhecidas

- OCR de PDFs digitalizados e imagens não está habilitado.
- Arquivos `.doc` e `.ppt` legados precisam ser convertidos para `.docx` e `.pptx`.
- A importação de URL não segue redirecionamentos e aceita somente endereços HTTPS com resolução pública; páginas que exigem login não podem ser importadas.
- Notificações push não estão configuradas; as revisões aparecem no dashboard e na agenda.
- O protótipo inclui envio SMTP para redefinição, mas não verificação de e-mail, autenticação multifator ou cobrança.
- A persistência SQLite em WASM é adequada para execução local e baixo volume; para uso multiusuário em produção, migre para PostgreSQL e armazenamento de objetos.

## Estrutura

- `src/server.mjs`: API HTTP, autenticação e composição dos módulos.
- `src/database.mjs`: esquema relacional e persistência SQLite.
- `src/content.mjs`, `src/worker.mjs`: extração e fila de processamento.
- `src/ai.mjs`: recuperação de fontes e integração com geração.
- `src/planning.mjs`: geração de agenda.
- `public/`: interface web responsiva e PWA.
- `data/`: banco e uploads locais (não versionados).
