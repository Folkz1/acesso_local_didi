/**
 * 🧪 Script de teste para o Bridge Server
 * 
 * Testa todas as funcionalidades do bridge localmente
 */

require('dotenv').config();
const path = require('path');

let BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:8788';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

if (!BRIDGE_TOKEN) {
  console.error('❌ BRIDGE_TOKEN não configurado no .env');
  process.exit(1);
}

async function testBridge() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 Testando Jarbas Remote Bridge');
  console.log('='.repeat(60) + '\n');

  let healthData = null;
  
  // Teste 1: Health Check
  console.log('1️⃣ Teste: Health Check');
  try {
    const response = await fetch(`${BRIDGE_URL}/health`);
    const data = await response.json();
    healthData = data;
    console.log('✅ Health OK:', data);
  } catch (err) {
    console.error('❌ Health falhou:', err.message);
    return;
  }
  
  // Teste 2: PowerShell simples
  console.log('\n2️⃣ Teste: PowerShell simples (echo)');
  try {
    const response = await fetch(`${BRIDGE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({
        tool: 'powershell',
        command: 'echo "Hello from PowerShell"'
      })
    });
    
    const data = await response.json();
    if (data.ok) {
      console.log('✅ PowerShell OK:', data.stdout.trim());
    } else {
      console.error('❌ PowerShell falhou:', data.error);
    }
  } catch (err) {
    console.error('❌ PowerShell falhou:', err.message);
  }
  
  // Teste 3: PowerShell com informações do sistema
  console.log('\n3️⃣ Teste: PowerShell (Get-ComputerInfo)');
  try {
    const response = await fetch(`${BRIDGE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({
        tool: 'powershell',
        command: 'Get-ComputerInfo | Select-Object CsName, WindowsVersion, OsArchitecture'
      })
    });
    
    const data = await response.json();
    if (data.ok) {
      console.log('✅ Get-ComputerInfo OK:');
      console.log(data.stdout);
    } else {
      console.error('❌ Get-ComputerInfo falhou:', data.error);
    }
  } catch (err) {
    console.error('❌ Get-ComputerInfo falhou:', err.message);
  }
  
  // Teste 4: Ferramenta não permitida
  console.log('\n4️⃣ Teste: Ferramenta não permitida (deve falhar)');
  try {
    const response = await fetch(`${BRIDGE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({
        tool: '__not_allowed__',
        command: 'echo test'
      })
    });
    
    const data = await response.json();
    if (!data.ok && (response.status === 403 || response.status === 500)) {
      console.log('✅ Bloqueio OK:', data.error);
    } else {
      console.error('❌ Deveria ter bloqueado!');
    }
  } catch (err) {
    console.error('❌ Teste falhou:', err.message);
  }
  
  // Teste 5: Token inválido
  console.log('\n5️⃣ Teste: Token inválido (deve falhar)');
  try {
    const response = await fetch(`${BRIDGE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token_invalido'
      },
      body: JSON.stringify({
        tool: 'powershell',
        command: 'echo test'
      })
    });
    
    const data = await response.json();
    if (response.status === 401) {
      console.log('✅ Auth OK: Bloqueou acesso não autorizado');
    } else {
      console.error('❌ Deveria ter bloqueado!');
    }
  } catch (err) {
    console.error('❌ Teste falhou:', err.message);
  }
  
  // ==================== TESTES DE JOBS ====================

  // Job 1: Criar job assincrono (powershell)
  console.log('\nJ1 Teste: Criar job assincrono (/jobs/run)');
  let jobId = null;
  try {
    const start = Date.now();
    const response = await fetch(`${BRIDGE_URL}/jobs/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({
        tool: 'powershell',
        command: 'Start-Sleep -Seconds 3; echo "JOB_OK"',
        timeout: 60000
      })
    });

    const data = await response.json();
    const elapsed = Date.now() - start;
    if (data.ok && data.jobId) {
      jobId = data.jobId;
      console.log('OK: Job criado:', jobId, `(submit: ${elapsed}ms)`);
    } else {
      console.error('ERRO: Job nao foi criado:', data.error || data);
    }
  } catch (err) {
    console.error('ERRO: /jobs/run falhou:', err.message);
  }

  // Job 2: Poll do job ate completar
  if (jobId) {
    console.log('\nJ2 Teste: Poll do job (/jobs/:id)');
    try {
      let status = null;
      const pollStart = Date.now();

      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));

        const response = await fetch(`${BRIDGE_URL}/jobs/${jobId}`, {
          headers: { 'Authorization': `Bearer ${BRIDGE_TOKEN}` }
        });

        status = await response.json();
        if (!response.ok) {
          console.error('ERRO: Poll falhou:', status.error || status);
          status = null;
          break;
        }

        if (status.status !== 'running') break;
      }

      if (status && status.status === 'completed' && (status.stdout || '').includes('JOB_OK')) {
        console.log('OK: Job completed:', `elapsed=${Date.now() - pollStart}ms`);
      } else if (status && status.status === 'failed') {
        console.error('ERRO: Job failed:', status.error || status.stderr || status);
      } else {
        console.error('ERRO: Job nao completou a tempo ou stdout inesperado:', status);
      }
    } catch (err) {
      console.error('ERRO: Poll falhou:', err.message);
    }
  }

  // Job 3: Listar jobs
  if (jobId) {
    console.log('\nJ3 Teste: Listar jobs (/jobs)');
    try {
      const response = await fetch(`${BRIDGE_URL}/jobs`, {
        headers: { 'Authorization': `Bearer ${BRIDGE_TOKEN}` }
      });

      const data = await response.json();
      if (data.ok && Array.isArray(data.jobs) && data.jobs.some(j => j.id === jobId)) {
        console.log('OK: Jobs list:', `count=${data.count}`);
      } else {
        console.error('ERRO: Jobs list falhou:', data);
      }
    } catch (err) {
      console.error('ERRO: Jobs list falhou:', err.message);
    }
  }

  // Job 4: Job inexistente
  console.log('\nJ4 Teste: Job inexistente (/jobs/:id)');
  try {
    const response = await fetch(`${BRIDGE_URL}/jobs/job_inexistente_123`, {
      headers: { 'Authorization': `Bearer ${BRIDGE_TOKEN}` }
    });

    const data = await response.json();
    if (response.status === 404 && !data.ok) {
      console.log('OK: 404 retornado:', data.error);
    } else {
      console.error('ERRO: Deveria retornar 404:', data);
    }
  } catch (err) {
    console.error('ERRO: Teste falhou:', err.message);
  }

  // ==================== TESTES DE ARQUIVO ====================

  const TEST_FILE = path.join(__dirname, 'logs', 'test-temp.txt');
  const TEST_CONTENT = 'Hello from Jarbas test!';

  // Teste 6: Escrever arquivo
  console.log('\n6️⃣ Teste: Escrever arquivo');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({
        path: TEST_FILE,
        content: TEST_CONTENT,
        createDirs: true
      })
    });

    const data = await response.json();
    if (data.ok) {
      console.log('✅ Write OK:', data.path, `(created: ${data.created})`);
    } else {
      console.error('❌ Write falhou:', data.error);
    }
  } catch (err) {
    console.error('❌ Write falhou:', err.message);
  }

  // Teste 7: Ler arquivo
  console.log('\n7️⃣ Teste: Ler arquivo');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({ path: TEST_FILE })
    });

    const data = await response.json();
    if (data.ok && data.content === TEST_CONTENT) {
      console.log('✅ Read OK:', data.content);
    } else {
      console.error('❌ Read falhou:', data.error || 'content mismatch');
    }
  } catch (err) {
    console.error('❌ Read falhou:', err.message);
  }

  // Teste 8: Info do arquivo
  console.log('\n8️⃣ Teste: Info do arquivo');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({ path: TEST_FILE })
    });

    const data = await response.json();
    if (data.ok && data.exists && data.isFile) {
      console.log('✅ Info OK:', `size=${data.size}, isFile=${data.isFile}`);
    } else {
      console.error('❌ Info falhou:', data);
    }
  } catch (err) {
    console.error('❌ Info falhou:', err.message);
  }

  // Teste 9: Listar diretório
  console.log('\n9️⃣ Teste: Listar diretório');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({ path: path.dirname(TEST_FILE) })
    });

    const data = await response.json();
    if (data.ok && data.entries.some(e => e.name === 'test-temp.txt')) {
      console.log('✅ List OK:', data.count, 'itens');
    } else {
      console.error('❌ List falhou:', data.error || 'file not in list');
    }
  } catch (err) {
    console.error('❌ List falhou:', err.message);
  }

  // Teste 10: Editar arquivo
  console.log('\n🔟 Teste: Editar arquivo (search-and-replace)');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({
        path: TEST_FILE,
        search: 'Hello',
        replace: 'World'
      })
    });

    const data = await response.json();
    if (data.ok && data.replacements === 1) {
      console.log('✅ Edit OK:', data.replacements, 'replacement(s)');
    } else {
      console.error('❌ Edit falhou:', data);
    }
  } catch (err) {
    console.error('❌ Edit falhou:', err.message);
  }

  // Teste 11: Verificar edição
  console.log('\n1️⃣1️⃣ Teste: Verificar edição');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({ path: TEST_FILE })
    });

    const data = await response.json();
    if (data.ok && data.content === 'World from Jarbas test!') {
      console.log('✅ Edit verification OK:', data.content);
    } else {
      console.error('❌ Edit verification falhou:', data.content);
    }
  } catch (err) {
    console.error('❌ Edit verification falhou:', err.message);
  }

  // Teste 12: Deletar arquivo
  console.log('\n1️⃣2️⃣ Teste: Deletar arquivo');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({ path: TEST_FILE })
    });

    const data = await response.json();
    if (data.ok && data.deleted) {
      console.log('✅ Delete OK');
    } else {
      console.error('❌ Delete falhou:', data.error);
    }
  } catch (err) {
    console.error('❌ Delete falhou:', err.message);
  }

  // Teste 13: Verificar deleção
  console.log('\n1️⃣3️⃣ Teste: Verificar deleção');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({ path: TEST_FILE })
    });

    const data = await response.json();
    if (data.ok && !data.exists) {
      console.log('✅ Deletion verified: file no longer exists');
    } else {
      console.error('❌ Deletion verification falhou: file still exists');
    }
  } catch (err) {
    console.error('❌ Deletion verification falhou:', err.message);
  }

  // Teste 14: Path traversal bloqueado
  console.log('\n1️⃣4️⃣ Teste: Path traversal bloqueado (deve falhar)');
  try {
    const response = await fetch(`${BRIDGE_URL}/files/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_TOKEN}`
      },
      body: JSON.stringify({ path: '..\\..\\..\\Windows\\System32\\config\\SAM' })
    });

    const data = await response.json();
    if (!data.ok && data.error.includes('traversal')) {
      console.log('✅ Path traversal bloqueado:', data.error);
    } else {
      console.error('❌ Path traversal deveria ter sido bloqueado!');
    }
  } catch (err) {
    console.error('❌ Teste falhou:', err.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Testes concluídos!');
  console.log('='.repeat(60) + '\n');
}

(async () => {
  const shouldStartServer = process.argv.includes('--start-server');
  let server = null;

  try {
    if (shouldStartServer) {
      const { startServer } = require('./bridge-server');
      server = startServer(0); // porta aleatória para não conflitar com o bridge "real"

      await new Promise((resolve) => server.on('listening', resolve));

      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 8788;
      BRIDGE_URL = `http://localhost:${port}`;

      console.log(`\nLocal bridge iniciado para testes em: ${BRIDGE_URL}`);
    }

    await testBridge();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }
})();
