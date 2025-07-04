// Función que suma dos números y retorna el resultado
function add(a: number, b: number): number {
  return a + b;
}

// Función que genera un saludo
function greet(name: string): string {
  const greeting: string = "Hello, " + name;
  return greeting;
}

// Función que realiza una operación condicional y retorna un número
function compute(value: number): number {
  let result = value;
  if (value > 10) {
    result = value * 2;
  } else {
    const temp = value + 5;
    result = temp;
  }
  // Variable definida pero nunca usada dentro de la función
  const unusedLocal: string = "Debug Info";
  return result;
}

// Función que nunca se invoca (código no usado)
function unusedFunction(): void {
  console.log("Esta función no se utiliza en ningún lado.");
}

// Clase con un constructor, propiedades y un método que utiliza las funciones anteriores
class Person {
  name: string;
  age: number;

  constructor(name: string, age: number) {
    this.name = name;
    this.age = age;
  }

  // Método que retorna una presentación de la persona usando la función 'greet'
  introduce(): string {
    return greet(this.name) + ", I am " + this.age + " years old.";
  }
}

// Uso de la clase y funciones definidas
const alice = new Person("Alice", 30);
console.log(alice.introduce());

const resultAdd = add(5, 7);
console.log("Resultado de add:", resultAdd);

const computedValue = compute(8);
console.log("Valor computado:", computedValue);

// Variable global que puede ser analizada en el contexto global
let globalVar = 100;

// Variable que se define y nunca se usa (para análisis de dead code)
const unusedVar = 42;
