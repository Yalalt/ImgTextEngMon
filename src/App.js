import './App.css';
import { useCallback, useEffect, useState } from 'react';
import { createWorker } from 'tesseract.js';

function App() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [textResult, setTextResult] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('mon'); // ['eng', 'mon']

  const convertImageToText = useCallback(async () => {
    try {
      const worker = await createWorker(selectedLanguage, 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0',
      });

      if (!selectedImage || !worker) return;

      const {
        data: { text },
      } = await worker.recognize(selectedImage);

      console.log(text);

      setTextResult(text);
      await worker.terminate();
    } catch (error) {
      console.log(error);
    }
  }, [selectedImage, selectedLanguage]);

  useEffect(() => {
    convertImageToText();
  }, [selectedImage, convertImageToText]);

  const handleChangeImage = (e) => {
    // e.preventDefault();
    if (e.target.files[0]) {
      console.log('Target file: ', e.target.files[0]);
      setSelectedImage(e.target.files[0]);
    } else {
      setSelectedImage(null);
      setTextResult('');
    }
  };

  return (
    <div className='App'>
      <h1>ImgText</h1>
      <p>Зурагнаас текст таньж авах</p>
      <div className='controlNav'>
        <div>
          <label htmlFor='language'>Хэл сонгох:</label>
          <select
            className='languageBar'
            id='language'
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
          >
            <option value='eng'>English</option>
            <option value='mon'>Монгол</option>
          </select>
        </div>
      </div>

      <div className='input-wrapper'>
        <label htmlFor='upload'>Зураг оруулах</label>
        <input type='file' id='upload' accept='image/*' onChange={handleChangeImage} />
      </div>

      <div className='result'>
        {selectedImage && (
          <div className='box-image'>
            <img src={URL.createObjectURL(selectedImage)} alt='thumb' />
          </div>
        )}
        {textResult && (
          <div className='box-p'>
            <p>{textResult}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
