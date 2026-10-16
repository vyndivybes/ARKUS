// Own each camera request so a late permission result cannot reactivate sharing.
export function createCameraCapture({acquire,onStream=()=>{},onError=()=>{}}){
  let generation=0,stream=null,pending=false;
  const release=media=>{for(const track of media.getTracks())track.stop()};
  function stop(){
    generation++;pending=false;
    const previous=stream;stream=null;
    if(previous)release(previous);
    onStream(null);
  }
  async function start(){
    if(pending||stream)return;
    const current=++generation;pending=true;
    try{
      const media=await acquire();
      if(current!==generation){release(media);return;}
      stream=media;pending=false;
      for(const track of media.getTracks())track.addEventListener('ended',()=>{
        if(current===generation)stop();
      },{once:true});
      onStream(media);
    }catch(error){if(current===generation){stop();onError(error);}}
  }
  return {start,stop,get active(){return Boolean(stream)},get connecting(){return pending}};
}
