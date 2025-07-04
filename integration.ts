import * as fs from 'fs';
import * as ts from 'typescript';
import * as path from 'path';
const defaultContext: VariableContext = { scope: 'global', line: 0 };
/**
 * Types representing the structure of function integration data
 */
interface FunctionDefinition {
  arguments: string[];
  argumentTypes: Record<string, string>;
  returns: string[];
  returnType: string;
}

interface FunctionCall {
  calledFunction: string;
  arguments: string[];
  argumentTypes: string[];
}

interface VariableFlow {
  sourceFunction: string;
  targetFunction: string;
  variables: string[];
  variableTypes: string[];
}

interface IntegrationMap {
  functionDefinitions: Record<string, FunctionDefinition>;
  interactionPaths: string[];
}

interface VariableContext {
  scope: string;
  line: number;
}

interface DeadCodeReport {
  unused: {
    variables: string[];
    functions: string[];
    classes: string[];
  };
  notAffectingReturn: {
    variables: string[];
    functions: string[];
    classes: string[];
  };
  variableScope: {
    globalVariables: string[];
    localVariables: string[];
    otherVariables: string[];
  };
  contexts: Record<string, VariableContext>;
  variableUsages: Record<string, string[]>;
}

/**
 * Class responsible for analyzing TypeScript code and mapping function interactions
 */
class FunctionIntegrationMapper {
  private filePath: string;
  private sourceCode: string;
  private sourceFile: ts.SourceFile;
  private typeChecker: ts.TypeChecker;
  private program: ts.Program;
  private functionDefinitions: Record<string, any> = {};
  private functionCalls: Record<string, FunctionCall[]> = {};
  private variableFlows: Record<string, VariableFlow[]> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
    this.sourceCode = this.readSourceCode();
    this.program = ts.createProgram([filePath], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS
    });
    this.typeChecker = this.program.getTypeChecker();
    this.sourceFile = this.program.getSourceFile(filePath)!;
  }

  private readSourceCode(): string {
    return fs.readFileSync(this.filePath, 'utf-8');
  }

  private inferType(node: ts.Node): string {
    if (ts.isStringLiteral(node)) {
      return 'string';
    } else if (ts.isNumericLiteral(node)) {
      return 'number';
    } else if (ts.isArrayLiteralExpression(node)) {
      return 'array';
    } else if (ts.isObjectLiteralExpression(node)) {
      return 'object';
    } else if (ts.isIdentifier(node)) {
      return 'variable';
    } else if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        return `function_call(${node.expression.text})`;
      }
    }
    return 'unknown';
  }

  private parseReturnType(signature: ts.Signature): string {
    const returnType = this.typeChecker.getReturnTypeOfSignature(signature);
    return this.typeChecker.typeToString(returnType);
  }

  private parseParameterTypes(signature: ts.Signature): Record<string, string> {
    const result: Record<string, string> = {};
    signature.parameters.forEach(parameter => {
      const parameterName = parameter.getName();
      const parameterType = this.typeChecker.getTypeOfSymbolAtLocation(
        parameter,
        parameter.valueDeclaration!
      );
      result[parameterName] = this.typeChecker.typeToString(parameterType);
    });
    return result;
  }

  private parseFunctionDefinitions(): void {
    ts.forEachChild(this.sourceFile, node => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.text;
        const signature = this.typeChecker.getSignatureFromDeclaration(node);
        const argumentTypes: Record<string, string> = {};
        const args: string[] = [];

        if (signature) {
          const paramTypes = this.parseParameterTypes(signature);
          Object.keys(paramTypes).forEach(paramName => {
            args.push(paramName);
            argumentTypes[paramName] = paramTypes[paramName];
          });
        } else {
          node.parameters.forEach(param => {
            if (ts.isIdentifier(param.name)) {
              const paramName = param.name.text;
              args.push(paramName);
              
              if (param.type) {
                argumentTypes[paramName] = this.getTypeAsString(param.type);
              } else {
                argumentTypes[paramName] = 'any';
              }
            }
          });
        }

        let returnType = 'unknown';
        if (node.type) {
          returnType = this.getTypeAsString(node.type);
        } else if (signature) {
          returnType = this.parseReturnType(signature);
        }

        this.functionDefinitions[functionName] = {
          node,
          args,
          argumentTypes,
          returns: this.extractReturnStatements(node),
          returnType
        };
      }
    });
  }

  private getTypeAsString(typeNode: ts.TypeNode): string {
    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
      return typeNode.typeName.text;
    } else if (ts.isUnionTypeNode(typeNode)) {
      return 'union';
    } else if (ts.isArrayTypeNode(typeNode)) {
      return 'array';
    } else if (ts.isLiteralTypeNode(typeNode)) {
      return 'literal';
    }
    return typeNode.kind.toString();
  }

  private extractReturnStatements(node: ts.FunctionDeclaration): string[] {
    const returns: string[] = [];
    
    const visit = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression) {
        if (ts.isIdentifier(node.expression)) {
          returns.push(node.expression.text);
        } else if (ts.isStringLiteral(node.expression) || ts.isNumericLiteral(node.expression)) {
          returns.push(node.expression.getText());
        }
      }
      ts.forEachChild(node, visit);
    };
    
    visit(node);
    return returns;
  }

  private traceFunctionCalls(): void {
    Object.keys(this.functionDefinitions).forEach(funcName => {
      this.functionCalls[funcName] = [];
      
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const calledFunc = node.expression.text;
          const args: string[] = [];
          const argTypes: string[] = [];
          
          node.arguments.forEach(arg => {
            if (ts.isIdentifier(arg)) {
              args.push(arg.text);
              argTypes.push(this.inferType(arg));
            }
          });
          
          this.functionCalls[funcName].push({
            calledFunction: calledFunc,
            arguments: args,
            argumentTypes: argTypes
          });
        }
        ts.forEachChild(node, visit);
      };
      
      visit(this.functionDefinitions[funcName].node);
    });
  }

  private traceVariableFlows(): void {
    Object.entries(this.functionCalls).forEach(([funcName, calls]) => {
      this.variableFlows[funcName] = [];
      
      calls.forEach(call => {
        const flowEntry: VariableFlow = {
          sourceFunction: funcName,
          targetFunction: call.calledFunction,
          variables: call.arguments,
          variableTypes: call.argumentTypes
        };
        
        this.variableFlows[funcName].push(flowEntry);
      });
    });
  }

  public generateIntegrationMap(): IntegrationMap {
    this.parseFunctionDefinitions();
    this.traceFunctionCalls();
    this.traceVariableFlows();
    
    const integrationMap: IntegrationMap = {
      functionDefinitions: {},
      interactionPaths: this.generateInteractionPaths()
    };
    
    Object.entries(this.functionDefinitions).forEach(([name, details]) => {
      integrationMap.functionDefinitions[name] = {
        arguments: details.arguments,
        argumentTypes: details.argumentTypes,
        returns: details.returns,
        returnType: details.returnType
      };
    });
    
    return integrationMap;
  }

  private generateInteractionPaths(): string[] {
    const interactionPaths: string[] = [];
    
    Object.entries(this.variableFlows).forEach(([_, flows]) => {
      flows.forEach(flow => {
        const path = `${flow.targetFunction} -> ${flow.sourceFunction}`;
        interactionPaths.push(path);
      });
    });
    
    return interactionPaths;
  }
}

/**
 * Class for analyzing TypeScript code to detect unused code elements
 */
class DeadCodeAnalyzer {
  private filePath: string;
  private sourceCode: string;
  private sourceFile: ts.SourceFile;
  private program: ts.Program;
  private typeChecker: ts.TypeChecker;
  
  private definedVariables: Set<string> = new Set();
  private usedVariables: Set<string> = new Set();
  private definedFunctions: Set<string> = new Set();
  private calledFunctions: Set<string> = new Set();
  private definedClasses: Set<string> = new Set();
  private usedClasses: Set<string> = new Set();
  
  private variablesAffectingReturns: Set<string> = new Set();
  private functionsAffectingReturns: Set<string> = new Set();
  private classesAffectingReturns: Set<string> = new Set();
  
  private variableContexts: Record<string, VariableContext> = {};
  private variableUsages: Record<string, string[]> = {};
  private globalVariables: Set<string> = new Set();
  private localVariables: Set<string> = new Set();
  private otherVariables: Set<string> = new Set();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.sourceCode = this.readSourceCode();
    this.program = ts.createProgram([filePath], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS
    });
    this.typeChecker = this.program.getTypeChecker();
    this.sourceFile = this.program.getSourceFile(filePath)!;
  }

  private readSourceCode(): string {
    return fs.readFileSync(this.filePath, 'utf-8');
  }

  public analyze(): DeadCodeReport {
    this.findDefinitions();
    this.findUsages();
    this.traceReturnDependencies();
    this.classifyVariables();
    return this.generateReport();
  }

  private findDefinitions(): void {
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        this.definedFunctions.add(node.name.text);
        
        node.parameters.forEach(param => {
          if (ts.isIdentifier(param.name)) {
            const varName = param.name.text;
            this.definedVariables.add(varName);
            
            this.variableContexts[varName] = {
              scope: node.name!.text,
              line: this.sourceFile.getLineAndCharacterOfPosition(param.pos).line + 1
            };
          }
        });
      } else if (ts.isClassDeclaration(node) && node.name) {
        this.definedClasses.add(node.name.text);
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const varName = node.name.text;
        this.definedVariables.add(varName);
        
        const scope = this.getScope(node);
        this.variableContexts[varName] = {
          scope,
          line: this.sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1
        };
      }
      
      ts.forEachChild(node, visit);
    };
    
    visit(this.sourceFile);
  }

  private getScope(node: ts.Node): string {
    let currentNode: ts.Node | undefined = node;
    
    while (currentNode && currentNode.parent) {
      currentNode = currentNode.parent;
      
      if (ts.isFunctionDeclaration(currentNode) && currentNode.name) {
        return `function:${currentNode.name.text}`;
      } else if (ts.isMethodDeclaration(currentNode) && currentNode.name) {
        const methodName = ts.isIdentifier(currentNode.name) 
          ? currentNode.name.text 
          : currentNode.name.getText();
        
        let className = "unknown";
        let classNode: ts.Node | undefined = currentNode.parent;
        while (classNode) {
          if (ts.isClassDeclaration(classNode) && classNode.name) {
            className = classNode.name.text;
            break;
          }
          classNode = classNode.parent;
        }
        
        return `method:${className}.${methodName}`;
      } else if (ts.isClassDeclaration(currentNode) && currentNode.name) {
        return `class:${currentNode.name.text}`;
      }
    }
    
    return "global";
  }

  private findUsages(): void {
    this.definedVariables.forEach(variable => {
      this.variableUsages[variable] = [];
    });
    
    const visit = (node: ts.Node) => {
      const currentFunction = this.getCurrentFunction(node);
      
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          this.calledFunctions.add(node.expression.text);
        } else if (ts.isPropertyAccessExpression(node.expression) && 
                  ts.isIdentifier(node.expression.expression)) {
          this.usedVariables.add(node.expression.expression.text);
          
          const varName = node.expression.expression.text;
          if (this.variableUsages[varName] && currentFunction) {
            this.variableUsages[varName].push(currentFunction);
          }
        }
      } else if (ts.isIdentifier(node) && !this.isDefinition(node)) {
        this.usedVariables.add(node.text);
        
        if (this.variableUsages[node.text] && currentFunction) {
          this.variableUsages[node.text].push(currentFunction);
        }
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
        if (this.definedClasses.has(node.expression.text)) {
          this.usedClasses.add(node.expression.text);
        }
      }
      
      ts.forEachChild(node, visit);
    };
    
    visit(this.sourceFile);
  }

  private isDefinition(node: ts.Identifier): boolean {
    if (node.parent) {
      return (ts.isVariableDeclaration(node.parent) && node.parent.name === node) ||
             (ts.isFunctionDeclaration(node.parent) && node.parent.name === node) ||
             (ts.isClassDeclaration(node.parent) && node.parent.name === node) ||
             (ts.isParameter(node.parent) && node.parent.name === node);
    }
    return false;
  }

    private getCurrentFunction(node: ts.Node): string | undefined {
    let currentNode: ts.Node | undefined = node;
    
    while (currentNode && currentNode.parent) {
        if (ts.isFunctionDeclaration(currentNode) && currentNode.name) {
        return currentNode.name.text;
        } else if (ts.isMethodDeclaration(currentNode) && currentNode.name) {
        const methodName = ts.isIdentifier(currentNode.name) 
            ? currentNode.name.text 
            : currentNode.name.getText();
        
        let className = "unknown";
        let classNode: ts.Node | undefined = currentNode.parent;
        while (classNode) {
            if (ts.isClassDeclaration(classNode) && classNode.name) {
            className = classNode.name.text;
            break;
            }
            classNode = classNode.parent;
        }
        
        return `${className}.${methodName}`;
        }
        
        currentNode = currentNode.parent;
    }
    
    return undefined;
    }
  private classifyVariables(): void {
    Object.entries(this.variableUsages).forEach(([varName, funcList]) => {
      if (this.definedVariables.has(varName) && this.usedVariables.has(varName)) {
        const uniqueFunctions = new Set(funcList);
        
        if (uniqueFunctions.size > 1) {
          this.globalVariables.add(varName);
        } else if (uniqueFunctions.size === 1) {
          this.localVariables.add(varName);
        } else {
          this.otherVariables.add(varName);
        }
      } else if (this.definedVariables.has(varName)) {
        this.otherVariables.add(varName);
      }
    });
  }

  private traceReturnDependencies(): void {
    const directDependencies = new Set<string>();
    
    const visitReturn = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression) {
        this.collectReturnDependencies(node.expression, directDependencies);
      }
      
      ts.forEachChild(node, visitReturn);
    };
    
    visitReturn(this.sourceFile);
    
    const allDependencies = this.resolveIndirectDependencies(directDependencies);
    
    allDependencies.forEach(dep => {
      if (this.definedVariables.has(dep)) {
        this.variablesAffectingReturns.add(dep);
      } else if (this.definedFunctions.has(dep)) {
        this.functionsAffectingReturns.add(dep);
      } else if (this.definedClasses.has(dep)) {
        this.classesAffectingReturns.add(dep);
      }
    });
  }

  private collectReturnDependencies(node: ts.Node, dependencies: Set<string>): void {
    if (ts.isIdentifier(node)) {
      dependencies.add(node.text);
    } else if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        dependencies.add(node.expression.text);
      }
      
      node.arguments.forEach(arg => {
        this.collectReturnDependencies(arg, dependencies);
      });
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(element => {
        this.collectReturnDependencies(element, dependencies);
      });
    } else if (ts.isObjectLiteralExpression(node)) {
      node.properties.forEach(prop => {
        if (ts.isPropertyAssignment(prop)) {
          this.collectReturnDependencies(prop.initializer, dependencies);
        }
      });
    } else if (ts.isBinaryExpression(node)) {
      this.collectReturnDependencies(node.left, dependencies);
      this.collectReturnDependencies(node.right, dependencies);
    } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      this.collectReturnDependencies(node.operand, dependencies);
    } else if (ts.isConditionalExpression(node)) {
      this.collectReturnDependencies(node.condition, dependencies);
      this.collectReturnDependencies(node.whenTrue, dependencies);
      this.collectReturnDependencies(node.whenFalse, dependencies);
    } else if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        dependencies.add(node.expression.text);
      }
    }
  }

  private resolveIndirectDependencies(directDeps: Set<string>): Set<string> {
    const allDeps = new Set<string>(directDeps);
    let newDeps = new Set<string>(directDeps);
    
    while (newDeps.size > 0) {
      const tempDeps = new Set<string>();
      
      // Process functions that are dependencies
      Array.from(newDeps)
        .filter(dep => this.definedFunctions.has(dep))
        .forEach(funcName => {
          const callsInside = this.findCallsInFunction(funcName);
          callsInside.forEach(call => {
            if (!allDeps.has(call)) {
              tempDeps.add(call);
            }
          });
          
          const varsInside = this.findVarsInFunction(funcName);
          varsInside.forEach(variable => {
            if (!allDeps.has(variable)) {
              tempDeps.add(variable);
            }
          });
        });
      
      // Process variables that are dependencies
      Array.from(newDeps)
        .filter(dep => this.definedVariables.has(dep))
        .forEach(varName => {
          const funcsAffectingVar = this.findFuncsAffectingVar(varName);
          funcsAffectingVar.forEach(func => {
            if (!allDeps.has(func)) {
              tempDeps.add(func);
            }
          });
        });
      
      // Prepare for next iteration
      newDeps = new Set<string>(
        Array.from(tempDeps).filter(dep => !allDeps.has(dep))
      );
      
      // Add new dependencies to all dependencies
      newDeps.forEach(dep => allDeps.add(dep));
    }
    
    return allDeps;
  }

  private findCallsInFunction(funcName: string): Set<string> {
    const calls = new Set<string>();
    
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.name.text === funcName) {
        const visitFunction = (innerNode: ts.Node) => {
          if (ts.isCallExpression(innerNode) && ts.isIdentifier(innerNode.expression)) {
            calls.add(innerNode.expression.text);
          }
          ts.forEachChild(innerNode, visitFunction);
        };
        
        ts.forEachChild(node, visitFunction);
      } else {
        ts.forEachChild(node, visit);
      }
    };
    
    visit(this.sourceFile);
    return calls;
  }

  private findVarsInFunction(funcName: string): Set<string> {
    const varsUsed = new Set<string>();
    
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.name.text === funcName) {
        const visitFunction = (innerNode: ts.Node) => {
          if (ts.isIdentifier(innerNode) && !this.isDefinition(innerNode)) {
            varsUsed.add(innerNode.text);
          }
          ts.forEachChild(innerNode, visitFunction);
        };
        
        ts.forEachChild(node, visitFunction);
      } else {
        ts.forEachChild(node, visit);
      }
    };
    
    visit(this.sourceFile);
    return varsUsed;
  }

  private findFuncsAffectingVar(varName: string): Set<string> {
    const funcs = new Set<string>();
    
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const visitFunction = (innerNode: ts.Node) => {
          if (ts.isVariableDeclaration(innerNode) && 
              ts.isIdentifier(innerNode.name) && 
              innerNode.name.text === varName) {
            funcs.add(node.name!.text);
          } else if (ts.isBinaryExpression(innerNode) && 
                     innerNode.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                     ts.isIdentifier(innerNode.left) && 
                     innerNode.left.text === varName) {
            funcs.add(node.name!.text);
          }
          
          ts.forEachChild(innerNode, visitFunction);
        };
        
        ts.forEachChild(node, visitFunction);
      } else {
        ts.forEachChild(node, visit);
      }
    };
    
    visit(this.sourceFile);
    return funcs;
  }

  private generateReport(): DeadCodeReport {
    const unusedVariables = Array.from(this.definedVariables)
      .filter(v => !this.usedVariables.has(v));
    
    const unusedFunctions = Array.from(this.definedFunctions)
      .filter(f => !this.calledFunctions.has(f));
    
    const unusedClasses = Array.from(this.definedClasses)
      .filter(c => !this.usedClasses.has(c));
    
    const usedButNotAffectingVariables = Array.from(this.usedVariables)
      .filter(v => this.definedVariables.has(v) && !this.variablesAffectingReturns.has(v));
    
    const usedButNotAffectingFunctions = Array.from(this.calledFunctions)
      .filter(f => this.definedFunctions.has(f) && !this.functionsAffectingReturns.has(f));
    
    const usedButNotAffectingClasses = Array.from(this.usedClasses)
      .filter(c => this.definedClasses.has(c) && !this.classesAffectingReturns.has(c));
    
    return {
      unused: {
        variables: unusedVariables,
        functions: unusedFunctions,
        classes: unusedClasses
      },
      notAffectingReturn: {
        variables: usedButNotAffectingVariables,
        functions: usedButNotAffectingFunctions,
        classes: usedButNotAffectingClasses
      },
      variableScope: {
        globalVariables: Array.from(this.globalVariables),
        localVariables: Array.from(this.localVariables),
        otherVariables: Array.from(this.otherVariables)
      },
      contexts: this.variableContexts,
      variableUsages: Object.fromEntries(
        Object.entries(this.variableUsages)
          .filter(([varName]) => this.usedVariables.has(varName))
          .map(([varName, funcs]) => [varName, Array.from(new Set(funcs))])
      )
    };
  }
}

/**
 * Generate a function integration map for a TypeScript file
 * @param filePath Path to the TypeScript file
 * @returns Integration map with function definitions and interaction paths
 */
export function generateFunctionIntegrationMap(filePath: string): IntegrationMap {
  const mapper = new FunctionIntegrationMapper(filePath);
  return mapper.generateIntegrationMap();
}

/**
 * Analyze a TypeScript file for dead code
 * @param filePath Path to the TypeScript file
 * @returns Report containing dead code analysis
 */
export function analyzeDeadCode(filePath: string): DeadCodeReport {
  const analyzer = new DeadCodeAnalyzer(filePath);
  return analyzer.analyze();
}

/**
 * Save a dead code report to a file
 * @param report Dead code analysis report
 * @param outputFile Path to save the report
 */
export function saveDeadCodeReport(report: DeadCodeReport, outputFile: string = "dead_code_report.txt"): void {
  let content = "=== DEAD CODE ANALYSIS ===\n\n";
  
  content += "VARIABLE CLASSIFICATION:\n";
  content += "-".repeat(40) + "\n";
  content += "Global Variables (used in multiple functions):\n";
  
  report.variableScope.globalVariables.forEach(varName => {
    const context = report.contexts[varName] || defaultContext;
    const scope = context.scope || 'global';
    const line = context.line || '?';
    const functions = report.variableUsages[varName] || [];
    content += `  - ${varName} (scope: ${scope}, line: ${line}, functions: ${functions.join(', ')})\n`;
  });
  
  content += "\nLocal Variables (used in a single function):\n";
  report.variableScope.localVariables.forEach(varName => {
    const context = report.contexts[varName] || defaultContext;
    const scope = context.scope || 'global';
    const line = context.line || '?';
    const functions = report.variableUsages[varName] || [];
    content += `  - ${varName} (scope: ${scope}, line: ${line}, function: ${functions.join(', ')})\n`;
  });
  
  content += "\nOther Variables (not classified as global or local):\n";
  report.variableScope.otherVariables.forEach(varName => {
    const context = report.contexts[varName] || defaultContext;
    const scope = context.scope || 'global';
    const line = context.line || '?';
    content += `  - ${varName} (scope: ${scope}, line: ${line})\n`;
  });
  
  content += "\n\nDEFINED BUT UNUSED ELEMENTS:\n";
  content += "-".repeat(40) + "\n";
  content += "Variables:\n";
  report.unused.variables.forEach(varName => {
    const context = report.contexts[varName] || defaultContext;
    const scope = context.scope;
    const line = context.line;
    content += `  - ${varName} (scope: ${scope}, line: ${line})\n`;
  });
  
  content += "\nFunctions:\n";
  report.unused.functions.forEach(funcName => {
    content += `  - ${funcName}\n`;
  });
  
  content += "\nClasses:\n";
  report.unused.classes.forEach(className => {
    content += `  - ${className}\n`;
  });
  
  content += "\n\nELEMENTS NOT AFFECTING FINAL RETURN:\n";
  content += "-".repeat(40) + "\n";
  content += "Variables:\n";
  report.notAffectingReturn.variables.forEach(varName => {
    const context = report.contexts[varName] || defaultContext;
    const scope = context.scope;
    const line = context.line;
    const functions = report.variableUsages[varName] || [];
    content += `  - ${varName} (scope: ${scope}, line: ${line}, functions: ${functions.join(', ')})\n`;
  });
  
  content += "\nFunctions:\n";
  report.notAffectingReturn.functions.forEach(funcName => {
    content += `  - ${funcName}\n`;
  });
  
  content += "\nClasses:\n";
  report.notAffectingReturn.classes.forEach(className => {
    content += `  - ${className}\n`;
  });
  
  content += "\n\nVARIABLE USAGE SUMMARY:\n";
  content += "-".repeat(40) + "\n";
  
  Object.entries(report.variableUsages).forEach(([varName, functions]) => {
    content += `${varName}: used in ${functions.length} function(s): ${functions.join(', ')}\n`;
  });
  
  fs.writeFileSync(outputFile, content, 'utf-8');
  console.log(`Dead code analysis saved to ${outputFile}`);
}

/**
 * Main function to run the code analysis on a TypeScript file
 * @param filePath Path to the TypeScript file to analyze
 * @param outputPath Path to save the analysis report
 */
export function analyzeCodeStructure(filePath: string, outputPath?: string): {
  integrationMap: IntegrationMap;
  deadCodeReport: DeadCodeReport;
} {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const integrationMap = generateFunctionIntegrationMap(filePath);
  const deadCodeReport = analyzeDeadCode(filePath);
  
  if (outputPath) {
    const reportPath = path.join(outputPath, 'dead_code_report.txt');
    const mapPath = path.join(outputPath, 'integration_map.json');
    
    // Ensure output directory exists
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
    
    saveDeadCodeReport(deadCodeReport, reportPath);
    fs.writeFileSync(mapPath, JSON.stringify(integrationMap, null, 2), 'utf-8');
    console.log(`Analysis reports saved to ${outputPath}`);
  }
  
  return { integrationMap, deadCodeReport };
}

/**
 * Visualize the function integration map as a DOT graph
 * @param integrationMap The integration map to visualize
 * @param outputFile Path to save the DOT file
 */
// Función modificada: generateFunctionGraph
export function generateFunctionGraph(integrationMap: IntegrationMap, outputFile: string = "function_graph.dot"): void {
    let dotContent = 'digraph FunctionIntegration {\n';
    dotContent += '  rankdir=LR;\n';
    dotContent += '  node [shape=box, style=filled, fillcolor=lightblue];\n\n';
    
    // Agregar nodos para todas las funciones
    Object.keys(integrationMap.functionDefinitions).forEach(funcName => {
      const funcDef = integrationMap.functionDefinitions[funcName];
      const argsString = Array.isArray(funcDef.arguments) ? funcDef.arguments.join(', ') : '';
      const label = `${funcName}\\n(${argsString})\\nReturns: ${funcDef.returnType}`;
      dotContent += `  "${funcName}" [label="${label}"];\n`;
    });
    
    dotContent += '\n';
    
    // Agregar edges para las interacciones entre funciones
    integrationMap.interactionPaths.forEach(path => {
      const [source, target] = path.split(' -> ');
      if (integrationMap.functionDefinitions[source] && integrationMap.functionDefinitions[target]) {
        dotContent += `  "${source}" -> "${target}";\n`;
      }
    });
    
    dotContent += '}\n';
    
    fs.writeFileSync(outputFile, dotContent, 'utf-8');
    console.log(`Function graph saved to ${outputFile}`);
  }
  

/**
 * Generate a HTML report for better visualization of the code analysis
 * @param integrationMap The integration map to visualize
 * @param deadCodeReport The dead code analysis report
 * @param outputFile Path to save the HTML report
 */
export function generateHtmlReport(
  integrationMap: IntegrationMap,
  deadCodeReport: DeadCodeReport,
  outputFile: string = "code_analysis_report.html"
): void {
  let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TypeScript Code Analysis Report</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 {
      color: #2c3e50;
    }
    h1 {
      border-bottom: 2px solid #3498db;
      padding-bottom: 10px;
    }
    h2 {
      border-bottom: 1px solid #bdc3c7;
      padding-bottom: 5px;
      margin-top: 30px;
    }
    .container {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
    }
    .card {
      background: #f9f9f9;
      border-radius: 5px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      padding: 15px;
      margin-bottom: 20px;
      flex: 1;
      min-width: 300px;
    }
    .card h3 {
      margin-top: 0;
      color: #3498db;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    th, td {
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid #ddd;
    }
    th {
      background-color: #f2f2f2;
    }
    .function-list, .variable-list {
      list-style-type: none;
      padding-left: 0;
    }
    .function-list li, .variable-list li {
      padding: 5px 0;
      border-bottom: 1px dashed #ddd;
    }
    .unused {
      color: #e74c3c;
    }
    .affects-return {
      color: #27ae60;
    }
    .not-affects-return {
      color: #f39c12;
    }
    .global-var {
      color: #8e44ad;
    }
    .local-var {
      color: #3498db;
    }
    .diagram {
      width: 100%;
      height: 500px;
      border: 1px solid #ddd;
      margin: 20px 0;
      background-color: #fff;
    }
    .code-preview {
      font-family: monospace;
      background-color: #f8f8f8;
      padding: 10px;
      border-radius: 3px;
      border-left: 3px solid #3498db;
      overflow-x: auto;
    }
    .metrics {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .metric-card {
      flex: 1;
      min-width: 150px;
      padding: 15px;
      background-color: #ecf0f1;
      border-radius: 5px;
      margin: 5px;
      text-align: center;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #2980b9;
    }
    .metric-label {
      font-size: 14px;
      color: #7f8c8d;
    }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 12px;
      margin-right: 5px;
    }
    .tag-unused {
      background-color: #fadbd8;
      color: #e74c3c;
    }
    .tag-global {
      background-color: #e8daef;
      color: #8e44ad;
    }
    .tag-local {
      background-color: #d4e6f1;
      color: #3498db;
    }
    .tag-return {
      background-color: #d5f5e3;
      color: #27ae60;
    }
  </style>
</head>
<body>
  <h1>TypeScript Code Analysis Report</h1>
  
  <div class="metrics">
    <div class="metric-card">
      <div class="metric-value">${Object.keys(integrationMap.functionDefinitions).length}</div>
      <div class="metric-label">Functions</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${deadCodeReport.variableScope.globalVariables.length + 
                                   deadCodeReport.variableScope.localVariables.length + 
                                   deadCodeReport.variableScope.otherVariables.length}</div>
      <div class="metric-label">Variables</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${deadCodeReport.unused.variables.length + 
                                   deadCodeReport.unused.functions.length + 
                                   deadCodeReport.unused.classes.length}</div>
      <div class="metric-label">Unused Elements</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${deadCodeReport.variableScope.globalVariables.length}</div>
      <div class="metric-label">Global Variables</div>
    </div>
  </div>
  
  <h2>Function Integration Map</h2>
  <div class="card">
    <h3>Function Definitions</h3>
    <table>
      <thead>
        <tr>
          <th>Function Name</th>
          <th>Arguments</th>
          <th>Return Type</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  Object.entries(integrationMap.functionDefinitions).forEach(([funcName, funcDef]) => {
    const isUnused = deadCodeReport.unused.functions.includes(funcName);
    const affectsReturn = !deadCodeReport.notAffectingReturn.functions.includes(funcName) && !isUnused;
    const argsString = Array.isArray(funcDef.arguments) ? funcDef.arguments.join(', ') : '';
    htmlContent += `
        <tr>
          <td>${funcName}</td>
          <td>${argsString}</td>
          <td>${funcDef.returnType}</td>
          <td>
            ${isUnused ? '<span class="tag tag-unused">Unused</span>' : ''}
          </td>
        </tr>
    `;
  });

  
  htmlContent += `
      </tbody>
    </table>
    
    <h3>Interaction Paths</h3>
    <ul class="function-list">
  `;
  
  integrationMap.interactionPaths.forEach(path => {
    htmlContent += `<li>${path}</li>`;
  });
  
  htmlContent += `
    </ul>
  </div>
  
  <h2>Dead Code Analysis</h2>
  
  <div class="container">
    <div class="card">
      <h3>Variable Classification</h3>
      <table>
        <thead>
          <tr>
            <th>Variable Name</th>
            <th>Scope</th>
            <th>Line</th>
            <th>Classification</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  // Global variables
  deadCodeReport.variableScope.globalVariables.forEach(varName => {
    const context = deadCodeReport.contexts[varName] || defaultContext;
    const scope = context.scope;
    const line = context.line;
    const isUnused = deadCodeReport.unused.variables.includes(varName);

    htmlContent += `
        <tr>
          <td>${varName}</td>
          <td>${scope}</td>
          <td>${line}</td>
          <td>
            <span class="tag tag-global">Global</span>
            ${isUnused ? '<span class="tag tag-unused">Unused</span>' : ''}
          </td>
        </tr>
    `;
  });
  
  // Local variables
  deadCodeReport.variableScope.localVariables.forEach(varName => {
    const context = deadCodeReport.contexts[varName] || defaultContext;
    const scope = context.scope;
    const line = context.line;
    const isUnused = deadCodeReport.unused.variables.includes(varName);

    htmlContent += `
        <tr>
          <td>${varName}</td>
          <td>${scope}</td>
          <td>${line}</td>
          <td>
            <span class="tag tag-local">Local</span>
            ${isUnused ? '<span class="tag tag-unused">Unused</span>' : ''}
          </td>
        </tr>
    `;
  });
  
  // Other variables
  deadCodeReport.variableScope.otherVariables.forEach(varName => {
    const context = deadCodeReport.contexts[varName] || defaultContext;
    const scope = context.scope;
    const line = context.line;
    const isUnused = deadCodeReport.unused.variables.includes(varName);
    
    htmlContent += `
        <tr>
          <td>${varName}</td>
          <td>${scope}</td>
          <td>${line}</td>
          <td>
            ${isUnused ? '<span class="tag tag-unused">Unused</span>' : ''}
          </td>
        </tr>
    `;
  });
  
  htmlContent += `
        </tbody>
      </table>
    </div>
    
    <div class="card">
      <h3>Unused Elements</h3>
      
      <h4>Variables</h4>
      <ul class="variable-list">
  `;
  
  deadCodeReport.unused.variables.forEach(varName => {
    const context = deadCodeReport.contexts[varName] || defaultContext;
    const scope = context.scope;
    const line = context.line;
    
    htmlContent += `<li class="unused">${varName} (scope: ${scope}, line: ${line})</li>`;
  });
  
  htmlContent += `
      </ul>
      
      <h4>Functions</h4>
      <ul class="function-list">
  `;
  
  deadCodeReport.unused.functions.forEach(funcName => {
    htmlContent += `<li class="unused">${funcName}</li>`;
  });
  
  htmlContent += `
      </ul>
      
      <h4>Classes</h4>
      <ul class="function-list">
  `;
  
  deadCodeReport.unused.classes.forEach(className => {
    htmlContent += `<li class="unused">${className}</li>`;
  });
  
  htmlContent += `
      </ul>
    </div>
  </div>
  
  <div class="card">
    <h3>Elements Not Affecting Return Values</h3>
    
    <div class="container">
      <div>
        <h4>Variables</h4>
        <ul class="variable-list">
  `;
  
  deadCodeReport.notAffectingReturn.variables.forEach(varName => {
    const context = deadCodeReport.contexts[varName] || defaultContext;
    const scope = context.scope;
    const line = context.line;
    
    htmlContent += `<li class="not-affects-return">${varName} (scope: ${scope}, line: ${line})</li>`;
  });
  
  htmlContent += `
        </ul>
      </div>
      
      <div>
        <h4>Functions</h4>
        <ul class="function-list">
  `;
  
  deadCodeReport.notAffectingReturn.functions.forEach(funcName => {
    htmlContent += `<li class="not-affects-return">${funcName}</li>`;
  });
  
  htmlContent += `
        </ul>
      </div>
      
      <div>
        <h4>Classes</h4>
        <ul class="function-list">
  `;
  
  deadCodeReport.notAffectingReturn.classes.forEach(className => {
    htmlContent += `<li class="not-affects-return">${className}</li>`;
  });
  
  htmlContent += `
        </ul>
      </div>
    </div>
  </div>
  
  <h2>Variable Usage Summary</h2>
  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Variable Name</th>
          <th>Used In Functions</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  Object.entries(deadCodeReport.variableUsages).forEach(([varName, functions]) => {
    htmlContent += `
        <tr>
          <td>${varName}</td>
          <td>${functions.join(', ') || 'None'}</td>
        </tr>
    `;
  });
  
  htmlContent += `
      </tbody>
    </table>
  </div>
  
  <footer style="margin-top: 30px; text-align: center; color: #7f8c8d; font-size: 14px;">
    <p>Generated by TypeScript Code Analysis Tool on ${new Date().toLocaleString()}</p>
  </footer>
  
</body>
</html>
  `;
  
  fs.writeFileSync(outputFile, htmlContent, 'utf-8');
  console.log(`HTML report saved to ${outputFile}`);
}

/**
 * Command line interface for the code analysis tools
 */
export function runCliAnalysis(): void {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
TypeScript Code Analysis Tool

Usage:
  node analysis.js <file-path> [options]

Options:
  --output, -o <dir>     Directory to save analysis reports
  --format, -f <format>  Output format (text, html, dot, json)
  --help, -h             Show this help message

Examples:
  node analysis.js src/app.ts
  node analysis.js src/app.ts -o reports -f html
`);
    return;
  }
  
  const filePath = args[0];
  
  // Parse arguments
  let outputDir = './analysis-reports';
  let format = 'all';
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputDir = args[++i];
    } else if (args[i] === '--format' || args[i] === '-f') {
      format = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      runCliAnalysis();
      return;
    }
  }
  
  try {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    console.log(`Analyzing file: ${filePath}`);
    const { integrationMap, deadCodeReport } = analyzeCodeStructure(filePath);
    
    if (format === 'text' || format === 'all') {
      const reportPath = path.join(outputDir, 'dead_code_report.txt');
      saveDeadCodeReport(deadCodeReport, reportPath);
    }
    
    if (format === 'json' || format === 'all') {
      const mapPath = path.join(outputDir, 'integration_map.json');
      fs.writeFileSync(mapPath, JSON.stringify(integrationMap, null, 2), 'utf-8');
      
      const reportPath = path.join(outputDir, 'dead_code_report.json');
      fs.writeFileSync(reportPath, JSON.stringify(deadCodeReport, null, 2), 'utf-8');
    }
    
    if (format === 'dot' || format === 'all') {
      const dotPath = path.join(outputDir, 'function_graph.dot');
      generateFunctionGraph(integrationMap, dotPath);
    }
    
    if (format === 'html' || format === 'all') {
      const htmlPath = path.join(outputDir, 'code_analysis_report.html');
      generateHtmlReport(integrationMap, deadCodeReport, htmlPath);
    }
    
    console.log(`Analysis completed. Reports saved to ${outputDir}`);
  } catch (error) {
    console.error('Error during analysis:', error);
    process.exit(1);
  }
}

// Execute the CLI if this file is run directly
if (require.main === module) {
  runCliAnalysis();
}
