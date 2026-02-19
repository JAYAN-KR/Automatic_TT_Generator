// allow importing the JS timetable component without complaints
// this file is picked up automatically by the tsconfig "include": ["src"]

// support both specifiers with and without the .jsx extension
declare module './pages/timetable' {
  const value: any;
  export default value;
}

declare module './pages/timetable.jsx' {
  const value: any;
  export default value;
}
