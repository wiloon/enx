import cors from 'cors';
import express from 'express';

const app = express();
const PORT = 3000;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mock translation dictionary - maps English words to Chinese translations
const mockTranslations = {
  // Software development related terms (from test-page.html)
  'software': {
    query: 'software',
    errorCode: '0',
    returnPhrase: '软件',
    basic: {
      'us-phonetic': 'ˈsɔftwer',
      explains: ['n. 软件']
    }
  },
  'development': {
    query: 'development',
    errorCode: '0',
    returnPhrase: '开发',
    basic: {
      'us-phonetic': 'dɪˈveləpmənt',
      explains: ['n. 开发；发展']
    }
  },
  'engineering': {
    query: 'engineering',
    errorCode: '0',
    returnPhrase: '工程',
    basic: {
      'us-phonetic': 'ˌendʒɪˈnɪrɪŋ',
      explains: ['n. 工程；工程学']
    }
  },
  'process': {
    query: 'process',
    errorCode: '0',
    returnPhrase: '过程',
    basic: {
      'us-phonetic': 'ˈprɑses',
      explains: ['n. 过程；进程']
    }
  },
  'design': {
    query: 'design',
    errorCode: '0',
    returnPhrase: '设计',
    basic: {
      'us-phonetic': 'dɪˈzaɪn',
      explains: ['n. 设计；v. 设计']
    }
  },
  'implementation': {
    query: 'implementation',
    errorCode: '0',
    returnPhrase: '实现',
    basic: {
      'us-phonetic': 'ˌɪmplɪmenˈteɪʃn',
      explains: ['n. 实现；执行']
    }
  },
  'testing': {
    query: 'testing',
    errorCode: '0',
    returnPhrase: '测试',
    basic: {
      'us-phonetic': 'ˈtestɪŋ',
      explains: ['n. 测试；v. 测试']
    }
  },
  'deployment': {
    query: 'deployment',
    errorCode: '0',
    returnPhrase: '部署',
    basic: {
      'us-phonetic': 'dɪˈplɔɪmənt',
      explains: ['n. 部署；展开']
    }
  },
  'maintenance': {
    query: 'maintenance',
    errorCode: '0',
    returnPhrase: '维护',
    basic: {
      'us-phonetic': 'ˈmeɪntənəns',
      explains: ['n. 维护；保养']
    }
  },
  'quality': {
    query: 'quality',
    errorCode: '0',
    returnPhrase: '质量',
    basic: {
      'us-phonetic': 'ˈkwɑləti',
      explains: ['n. 质量；品质']
    }
  },
  'code': {
    query: 'code',
    errorCode: '0',
    returnPhrase: '代码',
    basic: {
      'us-phonetic': 'koʊd',
      explains: ['n. 代码；密码']
    }
  },
  'team': {
    query: 'team',
    errorCode: '0',
    returnPhrase: '团队',
    basic: {
      'us-phonetic': 'tim',
      explains: ['n. 团队；组']
    }
  },
  'project': {
    query: 'project',
    errorCode: '0',
    returnPhrase: '项目',
    basic: {
      'us-phonetic': 'ˈprɑdʒekt',
      explains: ['n. 项目；工程']
    }
  },
  'requirements': {
    query: 'requirements',
    errorCode: '0',
    returnPhrase: '需求',
    basic: {
      'us-phonetic': 'rɪˈkwaɪrmənts',
      explains: ['n. 需求；要求']
    }
  },
  'agile': {
    query: 'agile',
    errorCode: '0',
    returnPhrase: '敏捷',
    basic: {
      'us-phonetic': 'ˈædʒl',
      explains: ['adj. 敏捷的；灵活的']
    }
  },
  // TypeScript related terms (from typescript-page.html)
  'typescript': {
    query: 'typescript',
    errorCode: '0',
    returnPhrase: 'TypeScript',
    basic: {
      'us-phonetic': 'ˈtaɪpskrɪpt',
      explains: ['n. TypeScript（编程语言）']
    }
  },
  'javascript': {
    query: 'javascript',
    errorCode: '0',
    returnPhrase: 'JavaScript',
    basic: {
      'us-phonetic': 'ˈdʒɑvəskrɪpt',
      explains: ['n. JavaScript（编程语言）']
    }
  },
  'superset': {
    query: 'superset',
    errorCode: '0',
    returnPhrase: '超集',
    basic: {
      'us-phonetic': 'ˈsupərset',
      explains: ['n. 超集']
    }
  },
  'typed': {
    query: 'typed',
    errorCode: '0',
    returnPhrase: '类型化',
    basic: {
      'us-phonetic': 'taɪpt',
      explains: ['adj. 类型化的']
    }
  },
  'compiler': {
    query: 'compiler',
    errorCode: '0',
    returnPhrase: '编译器',
    basic: {
      'us-phonetic': 'kəmˈpaɪlər',
      explains: ['n. 编译器']
    }
  },
  'interface': {
    query: 'interface',
    errorCode: '0',
    returnPhrase: '接口',
    basic: {
      'us-phonetic': 'ˈɪntərfeɪs',
      explains: ['n. 接口；界面']
    }
  },
  'type': {
    query: 'type',
    errorCode: '0',
    returnPhrase: '类型',
    basic: {
      'us-phonetic': 'taɪp',
      explains: ['n. 类型；种类']
    }
  },
  'static': {
    query: 'static',
    errorCode: '0',
    returnPhrase: '静态',
    basic: {
      'us-phonetic': 'ˈstætɪk',
      explains: ['adj. 静态的']
    }
  },
  'generic': {
    query: 'generic',
    errorCode: '0',
    returnPhrase: '泛型',
    basic: {
      'us-phonetic': 'dʒəˈnerɪk',
      explains: ['adj. 泛型的；通用的']
    }
  },
  'module': {
    query: 'module',
    errorCode: '0',
    returnPhrase: '模块',
    basic: {
      'us-phonetic': 'ˈmɑdʒul',
      explains: ['n. 模块']
    }
  }
};

// Default translation for unknown words
const defaultTranslation = (word) => ({
  query: word,
  errorCode: '0',
  returnPhrase: `${word}（测试翻译）`,
  basic: {
    'us-phonetic': 'test',
    explains: [`n. ${word}（模拟翻译）`]
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mock-translation-api' });
});

// List all available mock translations (for debugging)
app.get('/mock/words', (req, res) => {
  const words = Object.keys(mockTranslations);
  res.json({
    count: words.length,
    words: words
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Mock Translation API running on http://localhost:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
  console.log(`📚 Available words: http://localhost:${PORT}/mock/words`);
  console.log(`📚 Mock words list: http://localhost:${PORT}/mock/words`);
});
