/**
 * 🌐 Jarbas Remote Executor - Client Library
 * 
 * Cliente HTTP para o Jarbas chamar o bridge server
 * Uso no código do Jarbas na VPS
 */

class RemoteExecutorClient {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.REMOTE_BRIDGE_URL;
    this.token = config.token || process.env.REMOTE_BRIDGE_TOKEN;
    this.timeout = config.timeout || 300000; // 5 minutos
    
    if (!this.baseUrl) {
      throw new Error('REMOTE_BRIDGE_URL não configurado');
    }
    
    if (!this.token) {
      throw new Error('REMOTE_BRIDGE_TOKEN não configurado');
    }
  }
  
  /**
   * Executa comando no bridge remoto
   * @param {Object} params
   * @param {string} params.tool - Ferramenta (powershell, codex, claude, etc.)
   * @param {string} params.command - Comando a executar
   * @param {Array} params.args - Argumentos adicionais (opcional)
   * @param {number} params.timeout - Timeout customizado (opcional)
   * @param {string} params.cwd - Diretório de execução (opcional)
   * @param {boolean} params.background - Executa em background e retorna imediatamente
   * @returns {Promise<Object>}
   */
  async execute({ tool, command, args = [], timeout, cwd, background = false }) {
    const url = `${this.baseUrl}/run`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          tool,
          command,
          args,
          timeout: timeout || this.timeout,
          cwd,
          background
        }),
        signal: AbortSignal.timeout(timeout || this.timeout)
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      
      return result;
      
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw err;
    }
  }
  
  /**
   * Executa comando PowerShell
   */
  async powershell(command, options = {}) {
    const normalized = typeof options === 'number' ? { timeout: options } : options;
    return this.execute({ tool: 'powershell', command, ...normalized });
  }

  /**
   * Executa PowerShell em background (não bloqueia request)
   */
  async powershellBackground(command, cwd, timeout = 30000) {
    return this.execute({
      tool: 'powershell',
      command,
      cwd,
      timeout,
      background: true
    });
  }
  
  /**
   * Executa Codex (Claude Code)
   */
  async codex(prompt, args = [], timeout) {
    return this.execute({ tool: 'codex', command: prompt, args, timeout });
  }
  
  /**
   * Executa Claude CLI
   */
  async claude(prompt, args = [], timeout) {
    return this.execute({ tool: 'claude', command: prompt, args, timeout });
  }
  
  /**
   * Executa Python
   */
  async python(script, args = [], timeout) {
    return this.execute({ tool: 'python', command: script, args, timeout });
  }
  
  // ==================== JOBS ASSÍNCRONOS ====================

  /**
   * Submete um job assíncrono (retorna jobId imediatamente)
   * Ideal para comandos demorados como codex, claude, etc.
   */
  async submitJob({ tool, command, args = [], timeout, cwd, background = false }) {
    const url = `${this.baseUrl}/jobs/run`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({ tool, command, args, timeout, cwd, background }),
      signal: AbortSignal.timeout(10000) // 10s para submeter
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }

  /**
   * Consulta status de um job
   */
  async getJobStatus(jobId) {
    const url = `${this.baseUrl}/jobs/${jobId}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10000)
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }

  /**
   * Lista todos os jobs
   */
  async listJobs() {
    const url = `${this.baseUrl}/jobs`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10000)
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }

  /**
   * Submete job e aguarda conclusão (poll automático)
   * @param {Object} params - Mesmos params de submitJob
   * @param {number} pollInterval - Intervalo entre polls em ms (padrão: 3000)
   * @param {number} maxWait - Tempo máximo de espera em ms (padrão: 600000 = 10min)
   */
  async executeAsync({ tool, command, args = [], timeout, cwd, background = false }, pollInterval = 3000, maxWait = 600000) {
    const submission = await this.submitJob({ tool, command, args, timeout, cwd, background });
    const jobId = submission.jobId;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));

      const status = await this.getJobStatus(jobId);
      if (status.status !== 'running') {
        return status;
      }
    }

    throw new Error(`Job ${jobId} timeout after ${maxWait}ms`);
  }

  // ==================== OPERAÇÕES DE ARQUIVO ====================

  /**
   * Helper genérico para operações de arquivo
   */
  async _fileOp(endpoint, body) {
    const url = `${this.baseUrl}/files/${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      return result;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw err;
    }
  }

  /**
   * Lê conteúdo de um arquivo
   */
  async readFile(filePath, encoding = 'utf8') {
    return this._fileOp('read', { path: filePath, encoding });
  }

  /**
   * Escreve/cria arquivo
   */
  async writeFile(filePath, content, createDirs = false) {
    return this._fileOp('write', { path: filePath, content, createDirs });
  }

  /**
   * Lista conteúdo de diretório
   */
  async listDir(dirPath, recursive = false) {
    return this._fileOp('list', { path: dirPath, recursive });
  }

  /**
   * Deleta arquivo ou pasta
   */
  async deleteFile(filePath, recursive = false) {
    return this._fileOp('delete', { path: filePath, recursive });
  }

  /**
   * Informações de arquivo (tamanho, datas, etc.)
   */
  async fileInfo(filePath) {
    return this._fileOp('info', { path: filePath });
  }

  /**
   * Edita arquivo com search-and-replace
   */
  async editFile(filePath, search, replace, all = false) {
    return this._fileOp('edit', { path: filePath, search, replace, all });
  }

  /**
   * Verifica saúde do bridge
   */
  async health() {
    const url = `${this.baseUrl}/health`;
    
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000)
      });
      
      return await response.json();
      
    } catch (err) {
      throw new Error(`Bridge health check failed: ${err.message}`);
    }
  }
}

module.exports = RemoteExecutorClient;

// ==================== EXEMPLO DE USO ====================

if (require.main === module) {
  (async () => {
    const client = new RemoteExecutorClient({
      baseUrl: 'http://100.64.1.5:8788',
      token: 'seu_token_aqui'
    });
    
    try {
      // Teste de saúde
      console.log('🔍 Verificando saúde do bridge...');
      const health = await client.health();
      console.log('✅ Bridge OK:', health);
      
      // Teste PowerShell
      console.log('\n🔍 Testando PowerShell...');
      const ps = await client.powershell('Get-ComputerInfo | Select-Object CsName, WindowsVersion');
      console.log('✅ PowerShell:', ps.stdout);

      // Teste File Operations
      console.log('\n🔍 Testando operações de arquivo...');
      const list = await client.listDir('D:\\');
      console.log('✅ Listar D:\\:', list.count, 'itens');

      const info = await client.fileInfo('D:\\jarbas_vida\\package.json');
      console.log('✅ Info:', info.exists ? `${info.size} bytes` : 'não existe');
      
    } catch (err) {
      console.error('❌ Erro:', err.message);
    }
  })();
}
