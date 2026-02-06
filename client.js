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
   * @returns {Promise<Object>}
   */
  async execute({ tool, command, args = [], timeout }) {
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
          timeout: timeout || this.timeout
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
  async powershell(command, timeout) {
    return this.execute({ tool: 'powershell', command, timeout });
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
