declare module 'mammoth' {
  interface Result {
    value: string
    messages: unknown[]
  }
  export function extractRawText(options: { buffer: Buffer }): Promise<Result>
  export function convertToHtml(options: { buffer: Buffer }): Promise<Result>
}
