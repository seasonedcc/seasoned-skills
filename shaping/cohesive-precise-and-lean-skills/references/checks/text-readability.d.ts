declare module 'text-readability' {
  const readability: {
    fleschKincaidGrade(text: string): number
    lexiconCount(text: string, removePunctuation?: boolean): number
    sentenceCount(text: string): number
    syllableCount(text: string): number
  }
  export default readability
}
