import { StorageServiceManager } from '../../../services/storage';
import * as XLSX from 'xlsx';
import { DataProvider, DataMetadata, DataColumn } from './ParquetDataProvider';

export class XlsxDataProvider implements DataProvider {
  private filePath: string;
  private fileSize: number;
  private workbook: XLSX.WorkBook | null = null;
  private metadata: DataMetadata | null = null;
  private currentSheetIndex = 0;
  private currentSheetData: unknown[][] | null = null;
  private previewContent?: Uint8Array;

  constructor(filePath: string, fileSize: number, previewContent?: Uint8Array) {
    this.filePath = filePath;
    this.fileSize = fileSize;
    this.previewContent = previewContent;
  }

  private async getWorkbook(): Promise<XLSX.WorkBook> {
    if (!this.workbook) {
      let arrayBuffer: ArrayBuffer;
      if (this.previewContent) {
        // 使用预览内容
        arrayBuffer = this.previewContent.buffer.slice(
          this.previewContent.byteOffset,
          this.previewContent.byteOffset + this.previewContent.byteLength
        );
      } else {
        // 没有预览内容时才请求
        arrayBuffer = await StorageServiceManager.getFileBlob(this.filePath);
      }
      try {
        this.workbook = XLSX.read(arrayBuffer, { type: 'array' });

      } catch (error) {
        console.error('XLSX parsing error:', error);
        throw error;
      }
    }
    return this.workbook;
  }

  private async getCurrentSheetData(): Promise<any[][]> {
    if (!this.currentSheetData) {
      const workbook = await this.getWorkbook();
      const sheetName = workbook.SheetNames[this.currentSheetIndex];
      const worksheet = workbook.Sheets[sheetName];
      this.currentSheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
    }
    return this.currentSheetData;
  }

  async loadMetadata(): Promise<DataMetadata> {
    if (this.metadata) {
      return this.metadata;
    }

    const workbook = await this.getWorkbook();
    const sheetData = await this.getCurrentSheetData();

    if (sheetData.length === 0) {
      this.metadata = {
        numRows: 0,
        numColumns: 0,
        columns: [],
        fileSize: this.fileSize,
        sheets: workbook.SheetNames,
      };
      return this.metadata;
    }

    // 假设第一行是标题行
    const headerRow = sheetData[0] || [];
    const columns: DataColumn[] = headerRow.map((header, index) => ({
      name: String(header) || `Column ${index + 1}`,
      type: 'string', // XLSX 中类型推断较简单，默认为字符串
    }));

    this.metadata = {
      numRows: Math.max(0, sheetData.length - 1), // 减去标题行
      numColumns: columns.length,
      columns,
      fileSize: this.fileSize,
      sheets: workbook.SheetNames,
    };

    return this.metadata;
  }

  async loadData(offset: number, limit: number): Promise<Record<string, unknown>[]> {
    const sheetData = await this.getCurrentSheetData();

    if (sheetData.length === 0) {
      return [];
    }

    // 跳过标题行（第一行）
    const dataRows = sheetData.slice(1);
    const chunk = dataRows.slice(offset, offset + limit);

    // 转换为对象数组格式，以便与 Parquet 格式保持一致
    const headerRow = sheetData[0] || [];
    return chunk.map(row => {
      const obj: Record<string, unknown> = {};
      headerRow.forEach((header, index) => {
        const key = String(header) || `Column ${index + 1}`;
        obj[key] = row[index] !== undefined ? row[index] : null;
      });
      return obj;
    });
  }

  async switchSheet(sheetIndex: number): Promise<void> {
    if (sheetIndex === this.currentSheetIndex) return;

    this.currentSheetIndex = sheetIndex;
    this.currentSheetData = null; // 清除缓存的工作表数据
    this.metadata = null; // 清除元数据缓存，因为切换工作表后列可能不同
  }
}
