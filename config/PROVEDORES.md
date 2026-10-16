# Referências dos adaptadores

Os endpoints foram conferidos em 14/10/2026. O aplicativo lista modelos da sua conta e permite informar o ID manualmente; catálogo, permissões e recursos dependem do provedor e do modelo.

| Provedor | Formato implementado | Documentação oficial |
| --- | --- | --- |
| Gemini | Generate Content | [Google](https://ai.google.dev/api/generate-content) |
| OpenAI | Chat Completions; transcrição | [Chat](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [áudio](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) |
| Groq | Chat Completions; transcrição | [Compatibilidade](https://console.groq.com/docs/openai), [áudio](https://console.groq.com/docs/speech-to-text) |
| xAI / Grok | Chat Completions | [xAI](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions) |
| NVIDIA NIM | Chat Completions hospedado | [NVIDIA](https://docs.api.nvidia.com/nim/reference/llm-apis) |
| Anthropic / Claude | Messages; lista de modelos | [API](https://platform.claude.com/docs/en/api/overview), [modelos](https://platform.claude.com/docs/en/api/models/list) |
| DeepSeek | Chat Completions | [DeepSeek](https://api-docs.deepseek.com/) |
| Mistral | Chat Completions | [Mistral](https://docs.mistral.ai/api) |
| OpenRouter | Chat Completions | [OpenRouter](https://openrouter.ai/docs/quickstart) |
| Together AI | Chat Completions | [Together](https://docs.together.ai/docs/inference/openai-compatibility) |
| Fireworks AI | Chat Completions | [Fireworks](https://docs.fireworks.ai/tools-sdks/openai-compatibility) |
| Cerebras | Chat Completions | [Cerebras](https://inference-docs.cerebras.ai/resources/openai) |
| Ollama | Compatibilidade OpenAI local | [Ollama](https://docs.ollama.com/api/openai-compatibility) |
| LM Studio / personalizada | Endpoint compatível OpenAI informado no `.env` | Requer servidor compatível rodando e modelo carregado. |

Os adaptadores foram testados com respostas simuladas nos três formatos de API, incluindo isolamento de credenciais, consentimento, validação de ferramentas e transcrição multipart. A voz Windows foi testada com síntese real. Não foram usadas chaves pessoais para validar chamadas ou cobrança reais nos provedores.
