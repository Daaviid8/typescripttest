import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as os from 'os';
import * as process from 'process';
import { performance } from 'perf_hooks';
import { cpus } from 'os';
import { EventEmitter } from 'events';

/**
 * Type definitions for test data structures
 */
namespace TestTypes {
    export type TestCase = {
        input: string;
        expected: number;
        description?: string;
        tags?: string[];
    };

    export type ParameterInfo = {
        value: any;
        type: string;
        source: string;
        type_validation?: ValidationStatus;
        constraint_validation?: ValidationStatus;
    };

    export type ValidationStatus = 'passed' | 'failed' | 'skipped' | 'not_applicable';

    export type ParameterValidation = {
        function_name: string;
        parameters: Record<string, ParameterInfo>;
        validation_status: ValidationStatus;
        error?: string;
    };

    export type TestResult = {
        status: 'passed' | 'failed' | 'error' | 'skipped';
        actual?: any;
        expected?: any;
        error_message?: string;
        execution_time?: number;
    };

    export type TestResults = Record<string, Record<string, TestResult>>;
    export type ParameterValidations = Record<string, Record<string, ParameterValidation>>;

    export type PerformanceMetrics = {
        execution_time: number;
        cpu_usage: number;
        ram_usage_mb: number;
        memory_storage_bytes: number;
        execution_speed_lines_per_second: number;
        cpu_info: {
            model: string;
            cores: number;
            speed: number;
        };
        memory_total_mb: number;
        test_environment: string;
    };

    export type TestReport = {
        summary: {
            filename: string;
            timestamp: string;
            execution_time: number;
            passed_tests: number;
            failed_tests: number;
            skipped_tests: number;
            total_tests: number;
            passing_percentage: number;
        };
        tests: TestResults;
        parameter_validations: ParameterValidations;
        performance: PerformanceMetrics;
        coverage?: CodeCoverage;
    };

    export type CodeCoverage = {
        functions: {
            covered: number;
            total: number;
            percentage: number;
        };
        statements: {
            covered: number;
            total: number;
            percentage: number;
        };
        branches: {
            covered: number;
            total: number;
            percentage: number;
        };
    };
}

/**
 * Test event emitter for reporting real-time test progress
 */
class TestEventEmitter extends EventEmitter {
    private static instance: TestEventEmitter;

    private constructor() {
        super();
    }

    public static getInstance(): TestEventEmitter {
        if (!TestEventEmitter.instance) {
            TestEventEmitter.instance = new TestEventEmitter();
        }
        return TestEventEmitter.instance;
    }

    public emitTestStart(functionName: string, testCase: string): void {
        this.emit('testStart', { functionName, testCase });
    }

    public emitTestResult(functionName: string, testCase: string, result: TestTypes.TestResult): void {
        this.emit('testResult', { functionName, testCase, result });
    }

    public emitSuiteStart(fileName: string): void {
        this.emit('suiteStart', { fileName });
    }

    public emitSuiteEnd(report: TestTypes.TestReport): void {
        this.emit('suiteEnd', { report });
    }
}

/**
 * Logger class for consistent output formatting
 */
class Logger {
    private static instance: Logger;
    private verbose: boolean;

    private constructor(verbose: boolean = false) {
        this.verbose = verbose;
    }

    public static getInstance(verbose: boolean = false): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(verbose);
        }
        return Logger.instance;
    }

    public setVerbose(verbose: boolean): void {
        this.verbose = verbose;
    }

    public info(message: string): void {
        console.log(`\x1b[36m[INFO]\x1b[0m ${message}`);
    }

    public success(message: string): void {
        console.log(`\x1b[32m[SUCCESS]\x1b[0m ${message}`);
    }

    public warning(message: string): void {
        console.log(`\x1b[33m[WARNING]\x1b[0m ${message}`);
    }

    public error(message: string, error?: Error): void {
        console.error(`\x1b[31m[ERROR]\x1b[0m ${message}`);
        if (error && this.verbose) {
            console.error(error.stack);
        }
    }

    public debug(message: string): void {
        if (this.verbose) {
            console.log(`\x1b[35m[DEBUG]\x1b[0m ${message}`);
        }
    }

    public testResult(functionName: string, testCase: string, result: TestTypes.TestResult): void {
        const status = result.status === 'passed' 
            ? `\x1b[32m${result.status}\x1b[0m` 
            : `\x1b[31m${result.status}\x1b[0m`;
        
        console.log(`  - ${functionName}(${testCase}): ${status}`);
        
        if (result.status === 'failed' || result.status === 'error') {
            console.log(`    Expected: ${result.expected}, Actual: ${result.actual}`);
            if (result.error_message) {
                console.log(`    Error: ${result.error_message}`);
            }
        }
    }
}

/**
 * Parameter validator with enhanced type checking capabilities
 */
class ParameterValidator {
    /**
     * Validates function parameters against expected types and constraints
     * @param func The function to validate parameters for
     * @param args The arguments passed to the function
     * @returns Parameter validation results
     */
    public static validateFunctionParameters(
        func: Function, 
        args: any[]
    ): TestTypes.ParameterValidation {
        const logger = Logger.getInstance();
        const parameterValidation: TestTypes.ParameterValidation = {
            "function_name": func.name,
            "parameters": {},
            "validation_status": 'passed'
        };
        
        try {
            // Extract parameter information from function definition
            const funcStr = func.toString();
            const paramMatch = funcStr.match(/\(([^)]*)\)/);
            
            if (paramMatch && paramMatch[1]) {
                const paramDefs = paramMatch[1].split(',').map(p => p.trim()).filter(p => p);
                
                for (let i = 0; i < paramDefs.length; i++) {
                    if (i < args.length) {
                        const paramName = paramDefs[i].replace(/:.+/, '').trim();
                        const paramInfo: TestTypes.ParameterInfo = {
                            "value": args[i],
                            "type": typeof args[i],
                            "source": "argument"
                        };
                        
                        // Extract type information from parameter definition
                        const typeMatch = paramDefs[i].match(/:\s*(\w+)(?:\s*\|\s*(\w+))?/);
                        if (typeMatch) {
                            const expectedTypes = [typeMatch[1]];
                            if (typeMatch[2]) expectedTypes.push(typeMatch[2]);
                            
                            const actualType = typeof args[i];
                            
                            // Handle special case for numeric types
                            if (expectedTypes.includes('number') && !isNaN(Number(args[i]))) {
                                paramInfo["type_validation"] = 'passed';
                            }
                            // Handle array types
                            else if (expectedTypes.includes('array') && Array.isArray(args[i])) {
                                paramInfo["type_validation"] = 'passed';
                            }
                            // Handle regular type checking
                            else if (expectedTypes.includes(actualType)) {
                                paramInfo["type_validation"] = 'passed';
                            }
                            else {
                                paramInfo["type_validation"] = 'failed';
                                parameterValidation["validation_status"] = 'failed';
                                logger.debug(`Parameter type mismatch: ${paramName} expected ${expectedTypes.join('|')} but got ${actualType}`);
                            }
                        } else {
                            // No type specified, skip validation
                            paramInfo["type_validation"] = 'not_applicable';
                        }
                        
                        // Add constraint validation placeholder
                        paramInfo["constraint_validation"] = 'not_applicable';
                        
                        parameterValidation.parameters[paramName] = paramInfo;
                    }
                }
            }
        } catch (e) {
            parameterValidation["validation_status"] = 'failed';
            parameterValidation["error"] = e.message;
            logger.error(`Parameter validation error: ${e.message}`, e);
        }
        
        return parameterValidation;
    }
}

/**
 * Module loader for TypeScript files with caching
 */
class ModuleLoader {
    private static cache: Map<string, any> = new Map();
    private static logger = Logger.getInstance();

    /**
     * Loads a TypeScript module, with caching for improved performance
     * @param filePath Path to the TypeScript file
     * @param forceReload Whether to force reload the module
     * @returns The loaded module
     */
    public static async loadModule(filePath: string, forceReload: boolean = false): Promise<any> {
        try {
            const absolutePath = path.resolve(filePath);
            
            // Return cached module if available and not forcing reload
            if (!forceReload && ModuleLoader.cache.has(absolutePath)) {
                ModuleLoader.logger.debug(`Using cached module for ${filePath}`);
                return ModuleLoader.cache.get(absolutePath);
            }
            
            ModuleLoader.logger.debug(`Loading module from ${filePath}`);
            
            // Read the file
            const fileContent = fs.readFileSync(absolutePath, 'utf-8');
            
            // Transpile the TypeScript to JavaScript
            const result = ts.transpileModule(fileContent, {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES2020,
                    esModuleInterop: true,
                    strict: true,
                }
            });
            
            // Create a temporary file with the transpiled JavaScript
            const tempDir = path.join(os.tmpdir(), 'ts-tester');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const tempFile = path.join(tempDir, `${path.basename(filePath, '.ts')}_${Date.now()}.js`);
            fs.writeFileSync(tempFile, result.outputText);
            
            // Import the module
            const module = await import(tempFile);
            
            // Cache the module
            ModuleLoader.cache.set(absolutePath, module);
            
            // Schedule cleanup of temporary file
            setTimeout(() => {
                try {
                    if (fs.existsSync(tempFile)) {
                        fs.unlinkSync(tempFile);
                        ModuleLoader.logger.debug(`Cleaned up temporary file ${tempFile}`);
                    }
                } catch (e) {
                    ModuleLoader.logger.warning(`Failed to clean up temporary file: ${e.message}`);
                }
            }, 5000);
            
            return module;
        } catch (e) {
            ModuleLoader.logger.error(`Error loading module: ${e.message}`, e);
            throw new Error(`Failed to load module ${filePath}: ${e.message}`);
        }
    }

    /**
     * Clears the module cache
     */
    public static clearCache(): void {
        ModuleLoader.cache.clear();
        ModuleLoader.logger.debug('Module cache cleared');
    }
}

/**
 * Parser for TypeScript files to extract metadata
 */
class TypeScriptParser {
    private static logger = Logger.getInstance();

    /**
     * Parses a TypeScript file to extract function docstrings
     * @param filePath Path to the TypeScript file
     * @returns Map of function names to their docstrings
     */
    public static parseDocstrings(filePath: string): Record<string, string> {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const sourceFile = ts.createSourceFile(
            filePath,
            fileContent,
            ts.ScriptTarget.Latest,
            true
        );
        
        const docstrings: Record<string, string> = {};
        
        function visit(node: ts.Node) {
            if (ts.isFunctionDeclaration(node) && node.name) {
                const funcName = node.name.text;
                let docComment = '';
                
                // Get JSDoc comments
                const jsDoc = ts.getJSDocCommentsAndTags(node);
                if (jsDoc && jsDoc.length > 0) {
                    docComment = jsDoc
                        .map(doc => doc.getFullText())
                        .join('\n')
                        .replace(/\/\*\*|\*\/|\s*\* ?/g, '')
                        .trim();
                }
                
                docstrings[funcName] = docComment;
            }
            
            ts.forEachChild(node, visit);
        }
        
        visit(sourceFile);
        TypeScriptParser.logger.debug(`Parsed ${Object.keys(docstrings).length} function docstrings from ${filePath}`);
        return docstrings;
    }

    /**
     * Extracts test cases from function docstrings
     * @param docstring The function docstring
     * @returns Array of test case objects
     */
    public static extractTestCases(docstring: string): TestTypes.TestCase[] {
        const testCases: TestTypes.TestCase[] = [];
        
        // Basic test case pattern: function(args) == result
        const basicPattern = /(\w+\([^)]*\))\s*==\s*(-?\d+(?:\.\d+)?)/g;
        
        // Advanced pattern with descriptions: @test function(args) == result - Description
        const advancedPattern = /@test\s+(\w+\([^)]*\))\s*==\s*(-?\d+(?:\.\d+)?)\s*(?:-\s*(.+))?/g;
        
        // Extract advanced test cases first
        let match;
        while ((match = advancedPattern.exec(docstring)) !== null) {
            testCases.push({
                'input': match[1],
                'expected': parseFloat(match[2]),
                'description': match[3] ? match[3].trim() : undefined
            });
        }
        
        // Then extract basic test cases if not already covered
        while ((match = basicPattern.exec(docstring)) !== null) {
            const testCase = match[1];
            // Check if this test case is already included (from advanced pattern)
            if (!testCases.some(tc => tc.input === testCase)) {
                testCases.push({
                    'input': testCase,
                    'expected': parseFloat(match[2])
                });
            }
        }
        
        return testCases;
    }

    /**
     * Finds all exported functions in a TypeScript file
     * @param filePath Path to the TypeScript file
     * @returns Array of exported function names
     */
    public static findExportedFunctions(filePath: string): string[] {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const sourceFile = ts.createSourceFile(
            filePath,
            fileContent,
            ts.ScriptTarget.Latest,
            true
        );
        
        const functions: string[] = [];
        
        function visit(node: ts.Node) {
            if (ts.isFunctionDeclaration(node) && node.name) {
                // Check if the function is exported
                const modifiers = ts.getModifiers(node);
                if (modifiers && modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                    functions.push(node.name.text);
                }
            } else if (ts.isVariableStatement(node)) {
                // Check for exported const functions
                const modifiers = ts.getModifiers(node);
                if (modifiers && modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                    node.declarationList.declarations.forEach(decl => {
                        if (decl.initializer && 
                            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
                            decl.name &&
                            ts.isIdentifier(decl.name)) {
                            functions.push(decl.name.text);
                        }
                    });
                }
            }
            
            ts.forEachChild(node, visit);
        }
        
        visit(sourceFile);
        TypeScriptParser.logger.debug(`Found ${functions.length} exported functions in ${filePath}`);
        return functions;
    }
}

/**
 * Test runner for executing function tests
 */
class TestRunner {
    private static logger = Logger.getInstance();
    private static eventEmitter = TestEventEmitter.getInstance();

    /**
     * Runs tests for all functions in a TypeScript file
     * @param filePath Path to the TypeScript file
     * @returns Test results and parameter validations
     */
    public static async runTests(filePath: string): Promise<{
        test_results: TestTypes.TestResults;
        parameter_validations: TestTypes.ParameterValidations;
        execution_time: number;
    }> {
        const testResults: TestTypes.TestResults = {};
        const parameterValidations: TestTypes.ParameterValidations = {};
        const startTime = performance.now();
        
        try {
            TestRunner.logger.info(`Running tests for ${filePath}`);
            TestRunner.eventEmitter.emitSuiteStart(filePath);
            
            const module = await ModuleLoader.loadModule(filePath);
            const docstrings = TypeScriptParser.parseDocstrings(filePath);
            
            for (const [funcName, docstring] of Object.entries(docstrings)) {
                const func = module[funcName];
                if (typeof func === 'function') {
                    const testCases = TypeScriptParser.extractTestCases(docstring);
                    
                    if (testCases.length > 0) {
                        testResults[funcName] = {};
                        parameterValidations[funcName] = {};
                        
                        TestRunner.logger.info(`Testing function: ${funcName} (${testCases.length} test cases)`);
                        
                        for (const testCase of testCases) {
                            const testStartTime = performance.now();
                            TestRunner.eventEmitter.emitTestStart(funcName, testCase.input);
                            
                            try {
                                const match = testCase.input.match(/\w+\((.*)\)/);
                                if (match) {
                                    const argsStr = match[1];
                                    let args: any[] = [];
                                    
                                    if (argsStr) {
                                        // More robust argument parsing
                                        args = TestRunner.parseArguments(argsStr);
                                    }
                                    
                                    const paramValidation = ParameterValidator.validateFunctionParameters(func, args);
                                    parameterValidations[funcName][testCase.input] = paramValidation;
                                    
                                    if (paramValidation.validation_status === 'passed') {
                                        const result = func(...args);
                                        const testEndTime = performance.now();
                                        const executionTime = testEndTime - testStartTime;
                                        
                                        // For numeric results, check with a small epsilon for floating point comparison
                                        const isPassing = typeof result === 'number' && typeof testCase.expected === 'number'
                                            ? Math.abs(result - testCase.expected) < 1e-6
                                            : result === testCase.expected;
                                        
                                        const testResult: TestTypes.TestResult = {
                                            status: isPassing ? 'passed' : 'failed',
                                            actual: result,
                                            expected: testCase.expected,
                                            execution_time: executionTime
                                        };
                                        
                                        testResults[funcName][testCase.input] = testResult;
                                        TestRunner.eventEmitter.emitTestResult(funcName, testCase.input, testResult);
                                        TestRunner.logger.testResult(funcName, testCase.input, testResult);
                                    } else {
                                        const testResult: TestTypes.TestResult = {
                                            status: 'error',
                                            error_message: 'Parameter validation failed',
                                            execution_time: performance.now() - testStartTime
                                        };
                                        
                                        testResults[funcName][testCase.input] = testResult;
                                        TestRunner.eventEmitter.emitTestResult(funcName, testCase.input, testResult);
                                        TestRunner.logger.testResult(funcName, testCase.input, testResult);
                                    }
                                } else {
                                    const testResult: TestTypes.TestResult = {
                                        status: 'error',
                                        error_message: 'Invalid test case format',
                                        execution_time: performance.now() - testStartTime
                                    };
                                    
                                    testResults[funcName][testCase.input] = testResult;
                                    TestRunner.eventEmitter.emitTestResult(funcName, testCase.input, testResult);
                                    TestRunner.logger.testResult(funcName, testCase.input, testResult);
                                }
                            } catch (e) {
                                const testResult: TestTypes.TestResult = {
                                    status: 'error',
                                    error_message: e.message,
                                    execution_time: performance.now() - testStartTime
                                };
                                
                                testResults[funcName][testCase.input] = testResult;
                                TestRunner.eventEmitter.emitTestResult(funcName, testCase.input, testResult);
                                TestRunner.logger.testResult(funcName, testCase.input, testResult);
                            }
                        }
                    } else {
                        TestRunner.logger.warning(`No test cases found for function: ${funcName}`);
                    }
                }
            }
        } catch (e) {
            TestRunner.logger.error(`Test execution error: ${e.message}`, e);
            return {
                test_results: { 
                    "error": { 
                        "global": { 
                            status: 'error',
                            error_message: e.message 
                        } 
                    } 
                },
                parameter_validations: {},
                execution_time: performance.now() - startTime
            };
        }
        
        return {
            test_results: testResults,
            parameter_validations: parameterValidations,
            execution_time: performance.now() - startTime
        };
    }

    /**
     * Parses function arguments from string representation
     * @param argsStr String representation of arguments
     * @returns Array of parsed arguments
     */
    private static parseArguments(argsStr: string): any[] {
        const args: any[] = [];
        let currentArg = '';
        let inString = false;
        let stringDelimiter = '';
        let bracketCount = 0;
    
        for (let i = 0; i < argsStr.length; i++) {
            const char = argsStr[i];
            
            // Handle string literals
            if ((char === '"' || char === "'") && (i === 0 || argsStr[i-1] !== '\\')) {
                if (!inString) {
                    inString = true;
                    stringDelimiter = char;
                } else if (char === stringDelimiter) {
                    inString = false;
                }
            }
            
            // Handle brackets (for arrays/objects)
            if (!inString) {
                if (char === '[' || char === '{') {
                    bracketCount++;
                } else if (char === ']' || char === '}') {
                    bracketCount--;
                }
            }
            
            // Process comma as argument separator only if not in a string or nested structure
            if (char === ',' && !inString && bracketCount === 0) {
                try {
                    args.push(TestRunner.evaluateArgument(currentArg.trim()));
                } catch (e) {
                    // If evaluation fails, use the raw string
                    args.push(currentArg.trim());
                }
                currentArg = '';
                continue;
            }
            
            currentArg += char;
        }
        
        // Don't forget the last argument
        if (currentArg.trim()) {
            try {
                args.push(TestRunner.evaluateArgument(currentArg.trim()));
            } catch (e) {
                args.push(currentArg.trim());
            }
        }
        
        return args;
    }

    /**
     * Evaluates a string argument to its appropriate JavaScript value
     * @param arg String representation of the argument
     * @returns Evaluated argument value
     */
    private static evaluateArgument(arg: string): any {
        // Handle common literals directly
        if (arg === 'undefined') return undefined;
        if (arg === 'null') return null;
        if (arg === 'true') return true;
        if (arg === 'false') return false;
        
        // Handle numeric values
        if (/^-?\d+(\.\d+)?$/.test(arg)) {
            return Number(arg);
        }
        
        // Handle string literals
        if ((arg.startsWith('"') && arg.endsWith('"')) || 
            (arg.startsWith("'") && arg.endsWith("'"))) {
            return arg.slice(1, -1);
        }
        
        // Handle arrays
        if (arg.startsWith('[') && arg.endsWith(']')) {
            try {
                return JSON.parse(arg);
            } catch (e) {
                throw new Error(`Invalid array format: ${arg}`);
            }
        }
        
        // Handle objects
        if (arg.startsWith('{') && arg.endsWith('}')) {
            try {
                return JSON.parse(arg);
            } catch (e) {
                throw new Error(`Invalid object format: ${arg}`);
            }
        }
        
        // Default fallback - try to safely evaluate
        try {
            return eval(`(${arg})`);
        } catch (e) {
            return arg;
        }
    }
}

/**
 * Performance analyzer for code execution
 */
class PerformanceAnalyzer {
    private static logger = Logger.getInstance();

    /**
     * Measures performance metrics for function execution
     * @param module The module containing the functions
     * @param functions Array of function names to test
     * @param iterations Number of iterations for performance testing
     * @returns Performance metrics
     */
    public static measurePerformance(
        module: any,
        functions: string[],
        iterations: number = 100
    ): TestTypes.PerformanceMetrics {
        PerformanceAnalyzer.logger.info(`Measuring performance (${iterations} iterations per function)`);
        
        const startTime = performance.now();
        const startUsage = process.cpuUsage();
        const startMemory = process.memoryUsage();
        
        let executedLines = 0;
        
        try {
            for (const funcName of functions) {
                const func = module[funcName];
                if (typeof func === 'function') {
                    PerformanceAnalyzer.logger.debug(`Running performance test for ${funcName}`);
                    
                    try {
                        for (let i = 0; i < iterations; i++) {
                            func();
                            executedLines++;
                        }
                    } catch (e) {
                        PerformanceAnalyzer.logger.warning(`Error executing ${funcName}: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            PerformanceAnalyzer.logger.error(`Performance measurement error: ${e.message}`, e);
        }
        
        const endTime = performance.now();
        const endUsage = process.cpuUsage(startUsage);
        const endMemory = process.memoryUsage();
        
        const executionTime = (endTime - startTime) / 1000; // in seconds
        const cpuUsage = (endUsage.user + endUsage.system) / 1000; // ms to seconds
        const ramUsage = endMemory.rss - startMemory.rss;
        
        // Memory usage estimation
        const memorySize = endMemory.heapUsed - startMemory.heapUsed;
        
        const executionSpeed = executedLines / executionTime;
        
        // Get CPU info
        const cpuInfo = cpus();
        const cpuModel = cpuInfo.length > 0 ? cpuInfo[0].model : 'Unknown';
        const cpuCount = cpuInfo.length;
        const cpuSpeed = cpuInfo.length > 0 ? cpuInfo[0].speed : 0;
        
        // Get total memory
        const totalMemory = os.totalmem();
        
        return {
            "execution_time": Number(executionTime.toFixed(4)),
            "cpu_usage": Number(cpuUsage.toFixed(2)),
            "ram_usage_mb": Number((ramUsage / (1024 * 1024)).toFixed(4)),
            "memory_storage_bytes": memorySize,
            "execution_speed_lines_per_second": Number(executionSpeed.toFixed(2)),
            "cpu_info": {
                "model": cpuModel,
                "cores": cpuCount,
                "speed": cpuSpeed
            },
            "memory_total_mb": Number((totalMemory / (1024 * 1024)).toFixed(2)),
            "test_environment": `${os.type()} ${os.release()} (${os.platform()}, ${os.arch()})`
        };
    }
}

/**
 * Report generator for test results
 */
class ReportGenerator {
    private static logger = Logger.getInstance();

    /**
     * Generates a comprehensive test report
     * @param filePath Path to the TypeScript file
     * @param options Report generation options
     * @returns Test report object
     */
    public static async generateReport(
        filePath: string,
        options: {
            outputPath?: string;
            iterations?: number;
            format?: 'json' | 'html' | 'text';
        } = {}
    ): Promise<TestTypes.TestReport> {
        const startTime = performance.now();
        
        ReportGenerator.logger.info(`Generating test report for ${filePath}`);
        
        // Set default options
        const outputPath = options.outputPath || './test-report';
        const iterations = options.iterations || 100;
        const format = options.format || 'json';
        
        try {
            // Run tests
            const testData = await TestRunner.runTests(filePath);
          // Load module for performance measurement
            const module = await ModuleLoader.loadModule(filePath);
            const exportedFunctions = TypeScriptParser.findExportedFunctions(filePath);
            
            // Measure performance
            const performanceMetrics = PerformanceAnalyzer.measurePerformance(
                module,
                exportedFunctions,
                iterations
            );
            
            // Calculate summary statistics
            let passedTests = 0;
            let failedTests = 0;
            let skippedTests = 0;
            let totalTests = 0;
            
            Object.values(testData.test_results).forEach(funcTests => {
                Object.values(funcTests).forEach(result => {
                    totalTests++;
                    if (result.status === 'passed') passedTests++;
                    else if (result.status === 'failed') failedTests++;
                    else if (result.status === 'skipped') skippedTests++;
                });
            });
            
            // Generate the final report
            const report: TestTypes.TestReport = {
                summary: {
                    filename: path.basename(filePath),
                    timestamp: new Date().toISOString(),
                    execution_time: testData.execution_time,
                    passed_tests: passedTests,
                    failed_tests: failedTests,
                    skipped_tests: skippedTests,
                    total_tests: totalTests,
                    passing_percentage: totalTests > 0 ? (passedTests / totalTests) * 100 : 0
                },
                tests: testData.test_results,
                parameter_validations: testData.parameter_validations,
                performance: performanceMetrics
            };
            
            // Save the report to file if outputPath is provided
            if (outputPath) {
                await ReportGenerator.saveReport(report, outputPath, format);
            }
            
            // Emit the suite end event
            TestEventEmitter.getInstance().emitSuiteEnd(report);
            
            return report;
        } catch (e) {
            ReportGenerator.logger.error(`Report generation error: ${e.message}`, e);
            throw new Error(`Failed to generate report: ${e.message}`);
        }
    }

    /**
     * Saves a test report to a file
     * @param report Test report object
     * @param outputPath Path to save the report
     * @param format Report format (json, html, or text)
     */
    private static async saveReport(
        report: TestTypes.TestReport, 
        outputPath: string, 
        format: 'json' | 'html' | 'text'
    ): Promise<void> {
        try {
            // Create directory if it doesn't exist
            const dirPath = path.dirname(outputPath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            
            // Generate appropriate file extension if not provided
            let filePath = outputPath;
            if (!path.extname(filePath)) {
                filePath += `.${format}`;
            }
            
            // Format and save the report
            switch (format) {
                case 'json':
                    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
                    break;
                    
                case 'html':
                    const htmlContent = ReportGenerator.formatReportAsHtml(report);
                    fs.writeFileSync(filePath, htmlContent);
                    break;
                    
                case 'text':
                    const textContent = ReportGenerator.formatReportAsText(report);
                    fs.writeFileSync(filePath, textContent);
                    break;
                    
                default:
                    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
            }
            
            ReportGenerator.logger.success(`Test report saved to ${filePath}`);
        } catch (e) {
            ReportGenerator.logger.error(`Error saving report: ${e.message}`, e);
            throw new Error(`Failed to save report: ${e.message}`);
        }
    }

    /**
     * Formats a test report as HTML
     * @param report Test report object
     * @returns HTML formatted report
     */
    private static formatReportAsHtml(report: TestTypes.TestReport): string {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report: ${report.summary.filename}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        h1, h2, h3 { color: #444; }
        .summary { display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 30px; }
        .summary-item { background-color: #fff; padding: 15px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); flex: 1; min-width: 200px; }
        .passed { color: #28a745; }
        .failed { color: #dc3545; }
        .skipped { color: #ffc107; }
        .error { color: #dc3545; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f4f4f4; }
        tr:hover { background-color: #f9f9f9; }
        .test-details { margin-bottom: 30px; }
        .performance { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 30px; }
        .percentage-bar { height: 20px; background-color: #e9ecef; border-radius: 5px; overflow: hidden; margin-top: 5px; }
        .percentage-fill { height: 100%; background-color: #28a745; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Test Report: ${report.summary.filename}</h1>
            <p>Generated on: ${new Date(report.summary.timestamp).toLocaleString()}</p>
        </header>
        
        <section>
            <h2>Summary</h2>
            <div class="summary">
                <div class="summary-item">
                    <h3>Tests</h3>
                    <p><span class="passed">${report.summary.passed_tests}</span> passed / 
                       <span class="failed">${report.summary.failed_tests}</span> failed / 
                       <span class="skipped">${report.summary.skipped_tests}</span> skipped</p>
                    <p>Total: ${report.summary.total_tests}</p>
                    <p>Passing rate: ${report.summary.passing_percentage.toFixed(2)}%</p>
                    <div class="percentage-bar">
                        <div class="percentage-fill" style="width: ${report.summary.passing_percentage}%"></div>
                    </div>
                </div>
                <div class="summary-item">
                    <h3>Performance</h3>
                    <p>Execution time: ${report.summary.execution_time.toFixed(2)} ms</p>
                    <p>CPU Usage: ${report.performance.cpu_usage} s</p>
                    <p>RAM Usage: ${report.performance.ram_usage_mb} MB</p>
                </div>
                <div class="summary-item">
                    <h3>Environment</h3>
                    <p>CPU: ${report.performance.cpu_info.model}</p>
                    <p>Cores: ${report.performance.cpu_info.cores}</p>
                    <p>System: ${report.performance.test_environment}</p>
                </div>
            </div>
        </section>
        
        <section class="test-details">
            <h2>Test Details</h2>
            ${Object.entries(report.tests).map(([funcName, tests]) => `
                <h3>Function: ${funcName}</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Test Case</th>
                            <th>Status</th>
                            <th>Expected</th>
                            <th>Actual</th>
                            <th>Time (ms)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(tests).map(([testCase, result]) => `
                            <tr>
                                <td>${testCase}</td>
                                <td class="${result.status}">${result.status}</td>
                                <td>${result.expected !== undefined ? result.expected : '-'}</td>
                                <td>${result.actual !== undefined ? result.actual : '-'}</td>
                                <td>${result.execution_time ? result.execution_time.toFixed(2) : '-'}</td>
                            </tr>
                            ${result.error_message ? `
                            <tr>
                                <td colspan="5" class="error">Error: ${result.error_message}</td>
                            </tr>
                            ` : ''}
                        `).join('')}
                    </tbody>
                </table>
            `).join('')}
        </section>
        
        <section class="performance">
            <h2>Performance Analysis</h2>
            <table>
                <tr>
                    <th>Metric</th>
                    <th>Value</th>
                </tr>
                <tr>
                    <td>Execution Time</td>
                    <td>${report.performance.execution_time} s</td>
                </tr>
                <tr>
                    <td>CPU Usage</td>
                    <td>${report.performance.cpu_usage} s</td>
                </tr>
                <tr>
                    <td>RAM Usage</td>
                    <td>${report.performance.ram_usage_mb} MB</td>
                </tr>
                <tr>
                    <td>Memory Storage</td>
                    <td>${(report.performance.memory_storage_bytes / 1024).toFixed(2)} KB</td>
                </tr>
                <tr>
                    <td>Execution Speed</td>
                    <td>${report.performance.execution_speed_lines_per_second} lines/s</td>
                </tr>
            </table>
        </section>
    </div>
</body>
</html>
        `;
    }

    /**
     * Formats a test report as plain text
     * @param report Test report object
     * @returns Plain text formatted report
     */
    private static formatReportAsText(report: TestTypes.TestReport): string {
        let text = '';
        
        // Header
        text += `TEST REPORT: ${report.summary.filename}\n`;
        text += `Generated: ${new Date(report.summary.timestamp).toLocaleString()}\n`;
        text += `=`.repeat(80) + `\n\n`;
        
        // Summary
        text += `SUMMARY\n`;
        text += `-`.repeat(80) + `\n`;
        text += `Tests: ${report.summary.total_tests} total, ${report.summary.passed_tests} passed, ${report.summary.failed_tests} failed, ${report.summary.skipped_tests} skipped\n`;
        text += `Passing rate: ${report.summary.passing_percentage.toFixed(2)}%\n`;
        text += `Execution time: ${report.summary.execution_time.toFixed(2)} ms\n\n`;
        
        // Test details
        text += `TEST DETAILS\n`;
        text += `-`.repeat(80) + `\n`;
        
        for (const [funcName, tests] of Object.entries(report.tests)) {
            text += `Function: ${funcName}\n`;
            
            for (const [testCase, result] of Object.entries(tests)) {
                text += `  - ${testCase}: ${result.status.toUpperCase()}\n`;
                
                if (result.expected !== undefined && result.actual !== undefined) {
                    text += `      Expected: ${result.expected}, Actual: ${result.actual}\n`;
                }
                
                if (result.error_message) {
                    text += `      Error: ${result.error_message}\n`;
                }
                
                if (result.execution_time) {
                    text += `      Time: ${result.execution_time.toFixed(2)} ms\n`;
                }
            }
            
            text += `\n`;
        }
        
        // Performance
        text += `PERFORMANCE\n`;
        text += `-`.repeat(80) + `\n`;
        text += `Execution Time: ${report.performance.execution_time} s\n`;
        text += `CPU Usage: ${report.performance.cpu_usage} s\n`;
        text += `RAM Usage: ${report.performance.ram_usage_mb} MB\n`;
        text += `Memory Storage: ${(report.performance.memory_storage_bytes / 1024).toFixed(2)} KB\n`;
        text += `Execution Speed: ${report.performance.execution_speed_lines_per_second} lines/s\n`;
        text += `Environment: ${report.performance.test_environment}\n`;
        text += `CPU: ${report.performance.cpu_info.model} (${report.performance.cpu_info.cores} cores @ ${report.performance.cpu_info.speed} MHz)\n`;
        
        return text;
    }
}

/**
 * Main CLI application
 */
class TSTester {
    private static logger = Logger.getInstance();

    /**
     * Parses command line arguments
     * @returns Parsed command line options
     */
    private static parseArgs(): {
        filePath: string;
        outputPath?: string;
        format?: 'json' | 'html' | 'text';
        iterations?: number;
        verbose?: boolean;
        help?: boolean;
    } {
        const args = process.argv.slice(2);
        const options: any = {
            filePath: '',
            outputPath: undefined,
            format: 'json',
            iterations: 100,
            verbose: false,
            help: false
        };
        
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            
            if (arg === '--help' || arg === '-h') {
                options.help = true;
            } else if (arg === '--output' || arg === '-o') {
                options.outputPath = args[++i];
            } else if (arg === '--format' || arg === '-f') {
                options.format = args[++i];
            } else if (arg === '--iterations' || arg === '-i') {
                options.iterations = parseInt(args[++i]);
            } else if (arg === '--verbose' || arg === '-v') {
                options.verbose = true;
            } else if (arg.startsWith('-')) {
                TSTester.logger.warning(`Unknown option: ${arg}`);
            } else {
                options.filePath = arg;
            }
        }
        
        return options;
    }

    /**
     * Displays help information
     */
    private static showHelp(): void {
        console.log(`
TS-Tester: TypeScript Unit Test Framework

Usage: ts-tester [options] <file>

Options:
  -h, --help                 Show this help information
  -o, --output <path>        Output path for the test report
  -f, --format <format>      Report format: json, html, or text (default: json)
  -i, --iterations <number>  Number of iterations for performance testing (default: 100)
  -v, --verbose              Enable verbose logging

Examples:
  ts-tester math.ts
  ts-tester --output reports/math-report --format html math.ts
  ts-tester -o report.json -i 500 -v math.ts
        `);
    }

    /**
     * Main entry point
     */
    public static async main(): Promise<void> {
        const options = TSTester.parseArgs();
        
        if (options.help) {
            TSTester.showHelp();
            return;
        }
        
        if (!options.filePath) {
            TSTester.logger.error('No file specified');
            TSTester.showHelp();
            process.exit(1);
        }
        
        // Set verbose mode if requested
        Logger.getInstance().setVerbose(options.verbose ?? false);
        
        try {
            // Check if file exists
            if (!fs.existsSync(options.filePath)) {
                TSTester.logger.error(`File not found: ${options.filePath}`);
                process.exit(1);
            }
            
            // Generate report
            const report = await ReportGenerator.generateReport(options.filePath, {
                outputPath: options.outputPath,
                iterations: options.iterations,
                format: options.format
            });
            
            // Display summary to console
            TSTester.logger.info(`Test Results Summary:`);
            TSTester.logger.info(`Total Tests: ${report.summary.total_tests}`);
            TSTester.logger.info(`Passed: ${report.summary.passed_tests}`);
            TSTester.logger.info(`Failed: ${report.summary.failed_tests}`);
            TSTester.logger.info(`Skipped: ${report.summary.skipped_tests}`);
            TSTester.logger.info(`Passing Rate: ${report.summary.passing_percentage.toFixed(2)}%`);
            
            // Exit with appropriate status code
            process.exit(report.summary.failed_tests > 0 ? 1 : 0);
        } catch (e) {
            TSTester.logger.error(`Error: ${e.message}`, e);
            process.exit(1);
        }
    }
}

// Run the application if this file is executed directly
if (require.main === module) {
    TSTester.main().catch(e => {
        console.error(`Fatal error: ${e.message}`);
        process.exit(1);
    });
}

// Export public APIs
export {
    TestRunner,
    ReportGenerator,
    ModuleLoader,
    TypeScriptParser,
    ParameterValidator,
    Logger,
    TestEventEmitter,
    PerformanceAnalyzer,
    TSTester,
    TestTypes
};
