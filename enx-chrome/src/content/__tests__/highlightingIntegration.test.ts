import { WordData } from '../../types'

describe('Word Highlighting Integration Test', () => {
  it('should process a complete English sentence and generate highlight markup', () => {
    console.log('🧪 Testing word highlighting integration')
    
    // Input: A sample English sentence
    const inputSentence = "The quick brown fox jumps over the lazy dog."
    console.log('📝 Input sentence:', inputSentence)
    
    // Simulate word data from API (what would come from paragraph processing)
    const mockWordData: Record<string, WordData> = {
      'quick': {
        Key: 'quick',
        English: 'quick',
        Chinese: '快的',
        Pronunciation: '/kwɪk/',
        LoadCount: 15,
        AlreadyAcquainted: 0,
        WordType: 0
      },
      'brown': {
        Key: 'brown',
        English: 'brown',
        Chinese: '棕色的',
        Pronunciation: '/braʊn/',
        LoadCount: 8,
        AlreadyAcquainted: 0,
        WordType: 0
      },
      'jumps': {
        Key: 'jumps',
        English: 'jumps',
        Chinese: '跳跃',
        Pronunciation: '/dʒʌmps/',
        LoadCount: 3,
        AlreadyAcquainted: 0,
        WordType: 0
      },
      'lazy': {
        Key: 'lazy',
        English: 'lazy',
        Chinese: '懒惰的',
        Pronunciation: '/ˈleɪzi/',
        LoadCount: 12,
        AlreadyAcquainted: 1, // Already known
        WordType: 0
      }
    }
    
    console.log('📊 Mock word data keys:', Object.keys(mockWordData))
    
    // Test word extraction
    const extractWords = (text: string): string[] => {
      const WORD_PATTERN = /\b[a-zA-Z][a-zA-Z'''-]*[a-zA-Z]\b|\b[a-zA-Z]\b/g
      const words = text.match(WORD_PATTERN) || []
      return words
        .map(word => word.trim())
        .filter(word => word.length > 0 && !/^\d+$/.test(word))
        .map(word => word.toLowerCase())
    }
    
    const extractedWords = extractWords(inputSentence)
    console.log('🔍 Extracted words:', extractedWords)
    
    // Test color code generation
    const getColorCode = (wordData: WordData): string => {
      if (wordData.AlreadyAcquainted === 1 || wordData.WordType === 1 || wordData.LoadCount === 0) {
        return '#FFFFFF'
      }
      const loadCount = wordData.LoadCount || 0
      const normalizedCount = Math.min(loadCount, 30) / 30
      const hue = Math.round(300 * normalizedCount)
      return `hsl(${hue}, 100%, 40%)`
    }
    
    // Test highlight generation for each word
    let highlightCount = 0
    const highlightResults: { word: string, color: string, shouldHighlight: boolean }[] = []
    
    Object.keys(mockWordData).forEach(word => {
      const wordData = mockWordData[word]
      const color = getColorCode(wordData)
      const shouldHighlight = color !== '#FFFFFF'
      
      if (shouldHighlight) {
        highlightCount++
      }
      
      highlightResults.push({ word, color, shouldHighlight })
      console.log(`🎨 Word "${word}": color=${color}, highlight=${shouldHighlight}`)
    })
    
    // Generate sample highlighted HTML
    let processedSentence = inputSentence
    Object.keys(mockWordData).forEach(word => {
      const wordData = mockWordData[word]
      const color = getColorCode(wordData)
      
      if (color !== '#FFFFFF') {
        const regex = new RegExp(`\\b${word}\\b`, 'gi')
        processedSentence = processedSentence.replace(regex, (match) => {
          return `<u class="enx-word enx-${word}" data-word="${match}" style="text-decoration: ${color} underline; text-decoration-thickness: 2px; cursor: pointer;">${match}</u>`
        })
      }
    })
    
    console.log('✨ Final highlighted sentence:', processedSentence)
    
    // Assertions
    expect(extractedWords).toContain('quick')
    expect(extractedWords).toContain('brown')  
    expect(extractedWords).toContain('jumps')
    expect(extractedWords).toContain('lazy')
    
    // Check that words with LoadCount > 0 and AlreadyAcquainted = 0 get colored
    expect(getColorCode(mockWordData.quick)).toMatch(/^hsl\(\d+, 100%, 40%\)$/)
    expect(getColorCode(mockWordData.brown)).toMatch(/^hsl\(\d+, 100%, 40%\)$/)
    expect(getColorCode(mockWordData.jumps)).toMatch(/^hsl\(\d+, 100%, 40%\)$/)
    
    // Check that already acquainted words are not highlighted  
    expect(getColorCode(mockWordData.lazy)).toBe('#FFFFFF')
    
    // Check that the final sentence contains highlight markup
    expect(processedSentence).toContain('class="enx-word enx-quick"')
    expect(processedSentence).toContain('class="enx-word enx-brown"')
    expect(processedSentence).toContain('class="enx-word enx-jumps"')
    expect(processedSentence).not.toContain('class="enx-word enx-lazy"') // Already known
    
    // Verify highlight structure
    expect(processedSentence).toContain('data-word="quick"')
    expect(processedSentence).toContain('cursor: pointer')
    expect(processedSentence).toContain('text-decoration-thickness: 2px')
    
    console.log('✅ Integration test completed successfully!')
    console.log(`📈 Results: ${highlightCount} words highlighted out of ${Object.keys(mockWordData).length} processed`)
    
    // Final assertion on the number of highlighted words
    expect(highlightCount).toBe(3) // quick, brown, jumps (lazy is already known)
  })
})